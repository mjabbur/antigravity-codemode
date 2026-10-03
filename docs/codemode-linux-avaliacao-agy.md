# Avaliação Estática de Portabilidade Linux: Plugin Codemode

> **Autor:** Antigravity (agy)  
> **Data:** 03/10/2026  
> **Objetivo:** Análise estática minuciosa de compatibilidade do motor do Codemode no Linux (POSIX)  
> **Arquivos Analisados:**  
> - `src/security/path-policy.ts`  
> - `src/tools/fs-read.ts`  
> - `src/tools/fs-write.ts`  
> - (Contextuais: `src/tools/ripwire.ts`, `test/mcp.test.ts`, `test/security-fs.test.ts`)  
> **Regra Operacional:** Apenas avaliação arquitetural e estática; **nenhum código de produção ou teste foi modificado**.

---

## 1. Resumo Executivo e Contexto Medido no WSL

Nos testes preliminares medidos em ambiente Linux real (WSL, Node v24.19.0), o build TypeScript (`tsc`) compilou com sucesso, mas a suíte acusou 8 falhas em 41 testes (33/41 passaram). As falhas identificadas no ambiente WSL foram:
1. **M01 a M06 e `ripwire.test.ts`:** `createRipwireTools` lança exceção síncrona na inicialização do servidor MCP porque o binário do Ripwire possui caminho hardcoded para Windows (`c:\Dev\Joker\...\ripwire.exe`) e não há executável ELF Linux disponível no repositório.
2. **M07:** O teste do guarda de entrada usa caminhos absolutos com unidade Windows (`C:\...`), que no Linux são tratados como nomes de arquivo literais contendo barras invertidas sob o CWD.
3. **S18:** No teste de erro de I/O em caminho inválido (`bloqueio/sub.txt` onde `bloqueio` é um arquivo regular), o Linux retorna `ENOTDIR`, mas `fs-write.ts:78` captura exclusivamente `ENOENT`, propagando o erro antes de atingir o `applyStaged`.

Abaixo detalhamos a auditoria estática dividida nos quatro blocos temáticos exigidos e nas dependências de plataforma.

---

## 2. Bloco (a): `toLowerCase` e Filesystem Case-Sensitive

### Achado A1: Normalização Prematura com `toLowerCase()` na Checagem de Contenção do Workspace
* **Arquivo e Linha:** [`src/security/path-policy.ts:155`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L155)
* **Severidade:** **Crítica (Vulnerabilidade de Segurança no Linux)**
* **É bug no Linux?** **Sim.** No Linux ext4/xfs, diretórios cujos nomes diferem apenas pela caixa tipográfica são nós de arquivos completamente distintos.
* **Diagnóstico Técnico:**
  ```ts
  const rel = path.relative(this.workspaceRoot.toLowerCase(), canonical.toLowerCase());
  ```
  Se o `workspaceRoot` for `/home/user/App` e existir no sistema `/home/user/app` (fora do workspace), a chamada de `path.relative` transforma ambos para `/home/user/app`. Um caminho apontando para `/home/user/app/secrets.txt` produzirá um caminho relativo `"secrets.txt"`, passando na validação de contenção (linha 156) como se estivesse dentro do workspace, permitindo leitura ou escrita de arquivos fora do workspace do projeto.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("A1-POC: Bloqueia acesso a pasta irmã fora do workspace que difere apenas por caixa no Linux", async () => {
    // Cria /tmp/test-WS e /tmp/test-ws
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "case-test-"));
    const ws = path.join(parent, "Project");
    const outside = path.join(parent, "project");
    await fs.mkdir(ws);
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "leak.txt"), "secret");

    const policy = new PathPolicy(ws);
    // No Linux atual, isso NÃO lança SecurityError porque toLowerCase() iguala Project e project!
    expect(() => policy.resolvePath(path.join(outside, "leak.txt"), "read")).toThrow(SecurityError);
  });
  ```

---

### Achado A2: Colisão de Arquivos com Caixas Diferentes no Staging (`canonicalKey`)
* **Arquivo e Linha:** [`src/tools/fs-write.ts:66`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/tools/fs-write.ts#L66) e [`src/tools/fs-write.ts:117`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/tools/fs-write.ts#L117)
* **Severidade:** **Alta (Corrupção e Perda de Dados)**
* **É bug no Linux?** **Sim.** No Linux, `Foo.txt` e `foo.txt` são dois arquivos independentes e coexistem validamente no mesmo diretório.
* **Diagnóstico Técnico:**
  ```ts
  const canonicalKey = resolved.toLowerCase();
  ```
  Ao utilizar `resolved.toLowerCase()` como chave do `stagedMap`, se um script escrever simultaneamente em `Component.tsx` e `component.tsx`, o segundo sobrescreve o primeiro dentro do `stagedMap`. No momento do `applyStaged`, apenas um arquivo será gravado no disco, perdendo as alterações do outro. Além disso, em `editFile`, editar `foo.txt` pode alterar o buffer de staging pertencente a `Foo.txt`.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("A2-POC: Permite staging independente de arquivos que diferem apenas pela caixa no Linux", async () => {
    const writeTools = createFsWriteTools(policy);
    const writeFile = writeTools.find((t) => t.name === "writeFile")!;
    const getDiff = writeTools.find((t) => t.name === "getStagedDiff")!;

    await writeFile.execute({ path: "Arquivo.txt", content: "Conteudo A" });
    await writeFile.execute({ path: "arquivo.txt", content: "Conteudo B" });

    const diff = (await getDiff.execute({})) as string;
    // No Linux real, o diff DEVE conter ambos os arquivos staged
    expect(diff).toContain("+++ b/Arquivo.txt");
    expect(diff).toContain("+++ b/arquivo.txt");
  });
  ```

---

### Achado A3: Bloqueio Defensivo de Diretórios Sensíveis (`.git`, `.aws`, `.ssh`)
* **Arquivo e Linha:** [`src/security/path-policy.ts:94-96`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L94-L96) e [`src/security/path-policy.ts:161-163`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L161-L163)
* **Severidade:** **Baixa / Neutra (Comportamento Defensivo Aceitável)**
* **É bug no Linux?** **Não é bug (comportamento de segurança válido).**
* **Diagnóstico Técnico:**
  O código faz `segment.toLowerCase() === ".git"`. No Linux, o Git utiliza estritamente `.git` minúsculo. Bloquear variações como `.GIT` ou `.Git` em sistemas POSIX não gera falha de segurança; trata-se de postura defensiva contra confusão de ferramentas ou compartilhamento de repositórios em partições montadas (e.g. VFAT/NTFS via CIFS/NFS). Não requer alteração.
* **Teste Proposto:**
  ```ts
  it("A3-POC: Bloqueia variações de caixa de diretórios de controle (.GIT)", () => {
    expect(() => policy.resolvePath(".GIT/config", "read")).toThrow(SecurityError);
  });
  ```

---

## 3. Bloco (b): Regras Win32 que Bloqueiam Caminhos Linux Legítimos

### Achado B1: Truncamento Indevido de Nomes de Arquivo com Prefixos de Letra e Dois-Pontos (`/^[a-zA-Z]:/`)
* **Arquivo e Linha:** [`src/security/path-policy.ts:73`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L73)
* **Severidade:** **Alta (Corrupção Silenciosa de Caminhos)**
* **É bug no Linux?** **Sim.**
* **Diagnóstico Técnico:**
  ```ts
  const withoutDrive = /^[a-zA-Z]:/.test(targetPath) ? targetPath.slice(2) : targetPath;
  ```
  No Windows, `C:\...` ou `c:...` é letra de unidade de disco. No Linux, não existem letras de unidade. Um arquivo com nome legítimo no POSIX como `a:relatorio.txt` ou `v:1.0` é detectado como "drive letter", sofrendo `targetPath.slice(2)`, resultando em `relatorio.txt` ou `1.0`. A política passa a resolver e acessar um arquivo com nome totalmente diferente do solicitado pelo usuário.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("B1-POC: Preserva nome literal de arquivo iniciado por letra e dois-pontos no Linux", () => {
    // No Linux, targetPath "c:test.txt" deve resolver para <workspace>/c:test.txt, não <workspace>/test.txt
    const res = policy.resolvePath("c:test.txt", "read");
    expect(path.basename(res)).toBe("c:test.txt");
  });
  ```

---

### Achado B2: Bloqueio de Dois-Pontos `:` (Alternate Data Streams Win32)
* **Arquivo e Linha:** [`src/security/path-policy.ts:74-76`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L74-L76)
* **Severidade:** **Média (Falso Positivo Funcional)**
* **É bug no Linux?** **Sim.**
* **Diagnóstico Técnico:**
  ```ts
  if (withoutDrive.includes(":")) {
    throw new SecurityError(`Acesso negado: Alternate Data Streams não são permitidos ("${targetPath}").`);
  }
  ```
  No Windows NTFS, `arquivo.txt:stream` acessa fluxos ocultos de dados. No Linux, Alternate Data Streams não existem sob essa sintaxe e `:` é um caractere plenamente válido e rotineiro em nomes de arquivo (e.g. unidades do systemd `service@inst:1`, tags de containers, logs com timestamp `app-2026-10-03T05:00:00Z.log`, arquivos temporários de backup). O bloqueio incondicional rejeita esses arquivos com erro de segurança injustificado.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("B2-POC: Permite arquivos com ':' no nome em sistemas Linux", () => {
    expect(() => policy.resolvePath("logs/app-2026-10-03T05:00:00.log", "write")).not.toThrow();
  });
  ```

---

### Achado B3: Bloqueio de Trailing Dots e Spaces
* **Arquivo e Linha:** [`src/security/path-policy.ts:89-91`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L89-L91)
* **Severidade:** **Baixa (Falso Positivo)**
* **É bug no Linux?** **Sim (Restrição desnecessária no Linux).**
* **Diagnóstico Técnico:**
  No Win32, funções de arquivo silenciosamente removem pontos e espaços ao final dos nomes (ex: `foo. ` acessa `foo`), o que motivou a regra. No Linux, pontos ou espaços ao final são preservados com precisão e não sofrem truncamento pelo kernel. Rejeitar `teste...` ou `arquivo ` no Linux impede o uso de padrões válidos no POSIX.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("B3-POC: Permite arquivos terminados em ponto ou espaço no Linux", () => {
    expect(() => policy.resolvePath("src/ellipsis...", "write")).not.toThrow();
  });
  ```

---

### Achado B4: Bloqueio de Nomes Reservados do MS-DOS (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, etc.)
* **Arquivo e Linha:** [`src/security/path-policy.ts:104-108`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L104-L108)
* **Severidade:** **Média (Falso Positivo em Projetos C/Open-Source)**
* **É bug no Linux?** **Sim.**
* **Diagnóstico Técnico:**
  No Linux, `aux.c`, `prn.h` ou `nul.txt` são nomes comuns (ex: `aux.c` para rotinas auxiliares em pacotes GNU/Linux). O kernel Linux não tem conceito de dispositivos mapeados por nome de arquivo no namespace de diretórios comuns. O bloqueio atual impede a edição de fontes válidos em ambientes Unix.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("B4-POC: Permite nomes tradicionais como aux.c e con.h no Linux", () => {
    expect(() => policy.resolvePath("src/aux.c", "write")).not.toThrow();
  });
  ```

---

### Achado B5: Bloqueio de Nomes 8.3 (`~\d+`) e Caracteres Especiais Win32 (`< > " | ? *`)
* **Arquivo e Linha:** [`src/security/path-policy.ts:79`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L79) e [`path-policy.ts:100`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L100)
* **Severidade:** **Baixa (Falso Positivo)**
* **É bug no Linux?** **Parcial.**
* **Diagnóstico Técnico:**
  - Nomes curtos 8.3 (`doc~1.txt`) são usados por editores POSIX (Vim/Emacs) como convenção de cópias de segurança. No Linux não há risco de resolução implícita de aliasing NTFS.
  - Caracteres `< > " | ? *` são permitidos no POSIX, mas raramente recomendados em projetos limpos. Manter o bloqueio de caracteres especiais pode ser mantido por política geral de higiene, mas `~\d+` é falso positivo certo.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("B5-POC: Permite nomes de arquivos contendo til e números no Linux", () => {
    expect(() => policy.resolvePath("backup~1.txt", "read")).not.toThrow();
  });
  ```

---

## 4. Bloco (c): Symlinks e Resolução Canônica (`realpath`)

### Achado C1: Falha na Resolução de Ancestrais em Workspaces Acessados via Symlink
* **Arquivo e Linha:** [`src/security/path-policy.ts:130`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/security/path-policy.ts#L130)
* **Severidade:** **Alta (Falso Positivo em Ambientes com Symlink no Workspace)**
* **É bug no Linux?** **Sim.**
* **Diagnóstico Técnico:**
  ```ts
  while (cur.length >= this.workspaceRoot.length)
  ```
  No construtor, `this.workspaceRoot = fs.realpathSync(resolved)`. No Linux, caminhos como `/tmp` frequentemente são symlinks para `/var/tmp` ou `/run` para `/var/run`. Se um usuário abrir o workspace passando `/tmp/projeto` (comprimento 12) e `realpathSync` resolver para `/var/tmp/projeto` (comprimento 16):
  Ao criar um arquivo novo (`fs.existsSync(lexicalTarget) === false`), se `cur` iniciar em `/tmp/projeto`, a condição `cur.length >= this.workspaceRoot.length` (12 >= 16) avalia imediatamente para `false`! O loop de busca de ancestrais nem chega a ser executado. O caminho cai no fallback `canonical = lexicalTarget` e é posteriormente rejeitado na verificação de contenção como estando fora do workspace.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("C1-POC: Criação de arquivo novo sob workspace cujo caminho de entrada é um symlink no Linux", async () => {
    const realDir = await fs.mkdtemp(path.join(os.tmpdir(), "real-dir-"));
    const symlinkDir = path.join(os.tmpdir(), `symlink-${Date.now()}`);
    await fs.symlink(realDir, symlinkDir);

    const policy = new PathPolicy(symlinkDir);
    // Deve permitir resolver arquivo novo dentro do workspace symlinkado
    expect(() => policy.resolvePath("novo-arquivo.txt", "write")).not.toThrow();
  });
  ```

---

### Achado C2: `copyFile` Desfaz Symlinks no Processo de Backup do `applyStaged`
* **Arquivo e Linha:** [`src/tools/fs-write.ts:211`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/tools/fs-write.ts#L211)
* **Severidade:** **Média (Efeito Colateral em Symlinks Legítimos)**
* **É bug no Linux?** **Sim.**
* **Diagnóstico Técnico:**
  `fs.copyFile` em Node.js segue symlinks por padrão. Se o arquivo alterado for um link simbólico apontando para outro nó do projeto, o backup grava o conteúdo apontado. Caso ocorra rollback (linha 253), `fs.copyFile(bak, targetPath)` sobrescreverá o symlink transformando-o em arquivo comum, quebrando o grafo de links do repositório Linux.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("C2-POC: Garante que rollback do applyStaged preserva symlinks existentes", async () => {
    // Cria alvo e symlink
    const targetFile = path.join(tempDir, "real.txt");
    const linkFile = path.join(tempDir, "link.txt");
    await fs.writeFile(targetFile, "original");
    await fs.symlink(targetFile, linkFile);

    // Se houver falha no lote, o linkFile deve continuar sendo symlink
  });
  ```

---

## 5. Bloco (d): Rename, Unlink, Permissões POSIX e Erros I/O

### Achado D1: Tratamento de Erro Incompleto no `readFile` de Staging (`ENOTDIR` vs `ENOENT`) — **Medido no WSL (S18)**
* **Arquivo e Linha:** [`src/tools/fs-write.ts:78`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/tools/fs-write.ts#L78) e [`src/tools/fs-write.ts:133`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/tools/fs-write.ts#L133)
* **Severidade:** **Alta (Causa raiz da quebra do teste S18 no Linux)**
* **É bug no Linux?** **Sim (Confirmado e medido).**
* **Diagnóstico Técnico:**
  No Windows NTFS, ao tentar abrir `arquivo_regular/sub.txt`, o sistema retorna `ENOENT`. No Linux POSIX, o kernel retorna estritamente `ENOTDIR` ("Not a directory") porque um segmento do caminho não é diretório. Como o código trata apenas `code === "ENOENT"`, a chamada em `fs-write.ts:78` lança `ENOTDIR` de forma não tratada durante o `writeFileTool.execute`, abortando antes do lote ir para staging.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("D1-POC: writeFile lida com segmentos que colidem com arquivos existentes sem lançar ENOTDIR bruto", async () => {
    await fs.writeFile(path.join(tempDir, "arquivo"), "texto");
    const writeTools = createFsWriteTools(policy);
    const writeFile = writeTools.find((t) => t.name === "writeFile")!;

    // No Linux atual, isso lança Error: ENOTDIR em vez de tratar amigavelmente
    await expect(writeFile.execute({ path: "arquivo/filho.txt", content: "teste" })).rejects.toThrow();
  });
  ```

---

### Achado D2: Perda de Permissões POSIX (`st_mode`, `+x`) e Metadados na Aplicação Atômica
* **Arquivo e Linha:** [`src/tools/fs-write.ts:220-231`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/tools/fs-write.ts#L220-L231)
* **Severidade:** **Alta (Perda de Executabilidade de Scripts e Segurança no Linux)**
* **É bug no Linux?** **Sim.**
* **Diagnóstico Técnico:**
  ```ts
  const tempWritePath = `${entry.canonicalPath}.tmp.${Date.now()}.${Math.random()}`;
  await fs.writeFile(tempWritePath, entry.newContent, "utf-8");
  await fs.rename(tempWritePath, entry.canonicalPath);
  ```
  Ao criar `tempWritePath` via `fs.writeFile`, o arquivo nasce com a permissão padrão do `umask` (normalmente `0644`). Se o arquivo original em `entry.canonicalPath` for um script executável (`0755` / `chmod +x`), um utilitário CLI ou arquivo com permissões restritas (`0600`), o comando `fs.rename` substitui o inode original pelo inode temporário. Com isso, **o bit de execução `+x` é irremediavelmente perdido** e permissões estritas são relaxadas. No Linux, isso desativa scripts bash, hooks do git e binários locais.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("D2-POC: applyStaged preserva permissões POSIX (modo de execução 0755) no Linux", async () => {
    const scriptPath = path.join(tempDir, "script.sh");
    await fs.writeFile(scriptPath, "#!/bin/sh\necho ok", { mode: 0o755 });

    const writeTools = createFsWriteTools(policy);
    const editFile = writeTools.find((t) => t.name === "editFile")!;
    const applyStaged = writeTools.find((t) => t.name === "applyStaged")!;

    await editFile.execute({ path: "script.sh", oldText: "echo ok", newText: "echo modificado" });
    await applyStaged.execute({});

    const stat = await fs.stat(scriptPath);
    // No Linux atual, stat.mode perde os bits de execução 0o111 após o applyStaged!
    expect(stat.mode & 0o111).toBe(0o111);
  });
  ```

---

### Achado D3: Semântica POSIX de `rename` e Permissões de Diretório
* **Arquivo e Linha:** [`src/tools/fs-write.ts:225-232`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/tools/fs-write.ts#L225-L232)
* **Severidade:** **Média (Comportamento de Plataforma)**
* **É bug no Linux?** **Comportamento divergente do Windows.**
* **Diagnóstico Técnico:**
  No Linux POSIX, `rename(2)` é nativamente atômico mesmo sobre arquivo existente; o bloco `catch` com `unlink` (desenhado para Windows) nunca é acionado em circunstâncias normais. Contudo, no Linux a permissão para renomear/sobrescrever depende exclusivamente das permissões de escrita e execução da pasta pai (`w` e `x` no diretório), ignorando se o arquivo destino é `0444` (somente leitura). Se o arquivo for `0444` mas o diretório for gravável, o Linux sobrescreve o arquivo sem aviso.
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("D3-POC: Valida atomicidade do rename POSIX sem necessidade de fallback unlink", async () => {
    // Verifica se fs.rename substitui diretamente arquivo existente sem erro no Linux
  });
  ```

---

## 6. Achados Complementares Medidos no WSL

### Achado E1: Inicialização do Ripwire Quebra o Servidor MCP Inteiro (M01-M06)
* **Arquivo e Linha:** [`src/tools/ripwire.ts:28`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/tools/ripwire.ts#L28) e [`src/tools/ripwire.ts:87`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/src/tools/ripwire.ts#L87)
* **Severidade:** **Crítica (Impede Execução no Linux)**
* **É bug no Linux?** **Sim (Confirmado e medido no WSL).**
* **Diagnóstico Técnico:**
  Na linha 28, o candidato de fallback está fixo para um caminho Windows inexistente no Linux:
  `const candidate = "c:\\Dev\\Joker\\bin\\ripwire-0.6.5-windows-x64\\ripwire.exe";`
  Como `createRipwireTools` executa `resolveBinaryPath` síncrona e imediatamente na chamada da fábrica (linha 87), a falta de um binário no Linux dispara `throw new Error("Binário do Ripwire não encontrado...")`. Isso derruba a criação do `createCodemodeMcpServer()`, impedindo o uso de todas as demais ferramentas do plugin (inclusive ferramentas que não usam Ripwire, como `readFile`, `writeFile` e `codemode_run`).
* **Teste Proposto (Prova de Conceito):**
  ```ts
  it("E1-POC: createCodemodeMcpServer instancia sem lançar erro mesmo se ripwire não estiver presente no Linux", () => {
    delete process.env.RIPWIRE_PATH;
    // Atualmente lança erro e impede o servidor MCP de iniciar no Linux
    expect(() => createCodemodeMcpServer({ workspaceRoot: tempDir })).not.toThrow();
  });
  ```

---

### Achado E2: Teste M07 Incompatível com Plataforma POSIX
* **Arquivo e Linha:** [`test/mcp.test.ts:135-162`](file:///C:/Dev/Joker/.agents/plugins/codemode/server/test/mcp.test.ts#L135-L162)
* **Severidade:** **Baixa no Runtime / Alta na Suíte de Testes (Quebra CI/CD no Linux)**
* **É bug no Linux?** **Sim (Teste restrito a Windows).**
* **Diagnóstico Técnico:**
  O teste M07 testa o guarda do ponto de entrada instanciando strings do tipo `C:\Dev\Joker\...` e `file:///C:/...`. No Node.js rodando em Linux, `pathToFileURL("C:\\Dev\\...")` interpreta as barras invertidas como caracteres válidos do próprio nome do arquivo e não reconhece `C:` como volume, gerando uma URL incompatível.
* **Teste Proposto:** O teste M07 deve testar cenários específicos da plataforma atual (`process.platform === "win32"` vs POSIX) ou normalizar as URLs usando os separadores da plataforma corrente.

---

## 7. Matriz Consolidada de Achados

| ID | Arquivo:Linha | Categoria | Severidade | Bug no Linux? | Impacto Principal |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **A1** | `src/security/path-policy.ts:155` | Case Sensitivity | **Crítica** | **Sim** | Risco de quebra de contenção de workspace por `toLowerCase()` |
| **A2** | `src/tools/fs-write.ts:66, 117` | Case Sensitivity | **Alta** | **Sim** | Sobrescrita e perda de dados em arquivos como `Foo.txt` e `foo.txt` |
| **A3** | `src/security/path-policy.ts:94` | Case Sensitivity | Baixa | Não | Bloqueio defensivo de `.git` mantido |
| **B1** | `src/security/path-policy.ts:73` | Regras Win32 | **Alta** | **Sim** | Trunca indevidamente nomes POSIX com `[a-zA-Z]:` inicial |
| **B2** | `src/security/path-policy.ts:74` | Regras Win32 | Média | **Sim** | Rejeita nomes Linux com `:` legítimos como se fossem ADS |
| **B3** | `src/security/path-policy.ts:89` | Regras Win32 | Baixa | **Sim** | Rejeita trailing dots/spaces válidos no Linux |
| **B4** | `src/security/path-policy.ts:104` | Regras Win32 | Média | **Sim** | Rejeita nomes tradicionais do POSIX (`aux.c`, `prn.log`) |
| **B5** | `src/security/path-policy.ts:100` | Regras Win32 | Baixa | Parcial | Rejeita arquivos legítimos com til `~\d+` |
| **C1** | `src/security/path-policy.ts:130` | Symlinks | **Alta** | **Sim** | Rejeição de novos arquivos quando workspace reside em symlink |
| **C2** | `src/tools/fs-write.ts:211` | Symlinks | Média | **Sim** | `copyFile` quebra links simbólicos no backup/rollback |
| **D1** | `src/tools/fs-write.ts:78, 133` | POSIX I/O | **Alta** | **Sim** | Exceção não tratada com `ENOTDIR` quebra staging (S18) |
| **D2** | `src/tools/fs-write.ts:220` | Permissões | **Alta** | **Sim** | `rename` de arquivo temporário apaga bit executável `+x` |
| **E1** | `src/tools/ripwire.ts:28, 87` | Integração Externa | **Crítica** | **Sim** | Caminho Windows hardcoded e falta de binário Linux derruba o MCP |
| **E2** | `test/mcp.test.ts:135` | Testes | Média | **Sim** | Teste M07 amarrado à sintaxe de volumes Win32 |

---

## 8. Conclusão e Recomendações

O plugin `codemode` foi projetado com forte viés de contenção para sistemas de arquivos NTFS no Windows. Embora essa postura ofereça segurança máxima no Windows, ela cria vulnerabilidades e incompatibilidades graves no Linux:
1. **Segurança e Integridade no Linux:** É mandatório condicionar regras Windows (`DOS_RESERVED`, `ADS`, `8.3`, `drive letters`) ao `process.platform === "win32"` e cessar o uso indiscriminado de `toLowerCase()` na identificação canônica de arquivos em sistemas POSIX case-sensitive.
2. **Resiliência do Servidor MCP:** O Ripwire deve se tornar opcional ou carregar de forma preguiçosa (*lazy*), evitando que a falta de um binário ELF impeça a execução das ferramentas essenciais de filesystem e sandbox.
3. **Preservação de Permissões POSIX:** No `applyStaged`, ler e replicar o `mode` original (`fs.stat` seguido de `fs.chmod`) é essencial para que scripts executáveis e ferramentas de compilação continuem funcionando no Linux.
