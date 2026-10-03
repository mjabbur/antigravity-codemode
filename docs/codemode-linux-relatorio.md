# Relatório de Implementação de Portabilidade Linux: Plugin Codemode

> **Autor:** Antigravity (agy)  
> **Data:** 03/10/2026  
> **Branch de Trabalho:** `fix/codemode-linux-portability` (ramificada a partir de `fix/codemode-mcp-windows-guard`, sem merge)  
> **Status:** 100% Implementado, Compilado e Homologado no Windows (pronto para execução da suíte no WSL)  

---

## 1. Resumo dos Commits Realizados

A implementação foi dividida em commits atômicos por item de responsabilidade:

1. **Commit `0ad30ef`:** `fix(ripwire): make ripwire lazy/optional and resolve via PATH without fixed Windows fallback`
   * Itens abordados: **E1**
   * Arquivos: `src/tools/ripwire.ts`, `test/ripwire.test.ts`, `test/mcp.test.ts`
2. **Commit `cffe30d`:** `fix(security): support case-sensitive filesystems and platform-conditional Win32 path rules`
   * Itens abordados: **A1**, **B2**, **B3**, **B4**, **B5** (mantendo B1 e C1 intocados conforme medição no Linux)
   * Arquivos: `src/security/path-policy.ts`
3. **Commit `e65e3c2`:** `fix(fs-write): support case-sensitive staging, handle ENOTDIR, and preserve POSIX file permissions`
   * Itens abordados: **A2**, **D1**, **D2**
   * Arquivos: `src/tools/fs-write.ts`
4. **Commit `b22fa8c`:** `test: add multiplatform tests for case-sensitivity, POSIX filenames, ENOTDIR and mode preservation`
   * Itens abordados: **E2/M07**, **S18**, **S23-S28 (POCs A1, A2, B2, B4, B3, B5, D1, D2)**
   * Arquivos: `test/mcp.test.ts`, `test/security-fs.test.ts`

---

## 2. Detalhamento e Diff Resumido por Item

### (1) E1: Ripwire Opcional e Lazy Loading
* **Arquivos:** `src/tools/ripwire.ts`
* **Implementação:**
  * Removido o caminho estático `"c:\\Dev\\Joker\\bin\\ripwire-0.6.5-windows-x64\\ripwire.exe"`.
  * Nova função `findInPath(binName: string): string | null` pesquisa diretórios no `process.env.PATH` (com extensões executáveis `.exe`, `.cmd`, `.bat` no Windows e sem extensão no POSIX).
  * `resolveBinaryPath(customPath?: string): string | null` prioriza `customPath` (se fornecido), seguido de `process.env.RIPWIRE_PATH` e busca no `PATH`.
  * `createRipwireTools` não resolve o binário eager no momento de instanciação do servidor MCP. A verificação do binário foi transferida para `executeRipwire`, disparada sob demanda no momento da execução real de uma ferramenta Ripwire.
  * Se o binário não for localizado no sistema, o servidor MCP sobe normalmente, e apenas a invocação de ferramentas `ripwire.*` lança o erro:  
    `"Binário do Ripwire não encontrado. Defina a variável de ambiente RIPWIRE_PATH ou adicione 'ripwire' ao PATH do sistema."`
  * Em `test/ripwire.test.ts`, foi adicionado teste unitário específico `E1` validando essa mensagem amigável, e o bloco de testes de integração com o binário foi configurado com `describe.skipIf(!isRipwireAvailable)` para não quebrar a suíte quando executada em ambientes sem binário ELF do Ripwire.

### (2) A1 + A2: Suporte a Filesystems Case-Sensitive
* **Arquivos:** `src/security/path-policy.ts`, `src/tools/fs-write.ts`
* **Implementação:**
  * `PathPolicy` e `createFsWriteTools` agora aceitam opções injetáveis:
    ```ts
    export interface PathPolicyOptions {
      caseInsensitive?: boolean;
      isWindows?: boolean;
    }
    ```
    Com padrão definido automaticamente por `process.platform === "win32"`.
  * **A1 (`path-policy.ts`):** Na checagem de contenção do workspace (Regra 7), o uso indiscriminado de `toLowerCase()` agora ocorre **apenas quando `caseInsensitive === true`**. Em ambientes case-sensitive (`caseInsensitive === false`), foi adicionada verificação estrita de prefixo:
    ```ts
    if (!this.caseInsensitive) {
      if (canonical !== this.workspaceRoot && !canonical.startsWith(this.workspaceRoot + path.sep)) {
        throw new SecurityError(`Acesso negado: o caminho "${targetPath}" está fora do workspace.`);
      }
    }
    ```
    Impedindo que pastas irmãs fora do workspace com nomes em caixa diferente (ex: `/home/user/project` vs `/home/user/Project`) consigam burlar a contenção.
  * **A2 (`fs-write.ts`):** A geração da chave canônica do staging `canonicalKey = isCaseInsensitive ? resolved.toLowerCase() : resolved` agora preserva a caixa exata em sistemas case-sensitive. Arquivos como `Arquivo.txt` e `arquivo.txt` mantêm entradas separadas e independentes no `stagedMap`, eliminando o risco de colisão e perda de dados no Linux.

### (3) B2-B5: Regras Win32 Condicionais à Plataforma
* **Arquivos:** `src/security/path-policy.ts`
* **Implementação:**
  * As seguintes restrições foram condicionadas estritamente a `this.isWindows`:
    1. Bloqueio de Alternate Data Streams (`:`) — **B2**.
    2. Bloqueio de caracteres especiais do Win32 (`< > " | ? *`).
    3. Bloqueio de trailing dots e trailing spaces — **B3**.
    4. Bloqueio de nomes curtos 8.3 (`~\d+`) — **B5**.
    5. Bloqueio de nomes reservados do MS-DOS (`DOS_RESERVED.has(primaryName)`) — **B4**.
  * Regras universais mantidas incondicionais em todos os sistemas operacionais:
    - Caractere NUL (`\0`).
    - Bloqueio de caminhos UNC (`^[/\\]{2}`).
    - Bloqueio de prefixos de namespace Win32 (`^[/\\]{2,}[.?][/\\]`).
    - Bloqueio de diretórios sensíveis (`.git`, `.aws`, `.ssh`).
    - Bloqueio de segredos (`isSecretFile`).
    - Contenção no workspace.
  * **B1 e C1 mantidos intactos** conforme diretriz do dono: a heurística de drive letter (`/^[a-zA-Z]:/`) e a busca de ancestrais com `cur.length >= this.workspaceRoot.length` não foram alteradas.

### (4) D1 e D2: Robustez de I/O POSIX e Preservação de Permissões
* **Arquivos:** `src/tools/fs-write.ts`
* **Implementação:**
  * **D1:** Em `writeFile`, `editFile` e na validação otimista do `applyStaged`, o tratamento de erro na leitura do arquivo original passou a tratar `code === "ENOTDIR"` da mesma forma que `ENOENT`. Em sistemas POSIX (Linux/macOS), ao tentar ler um caminho onde um componente pai intermediário é um arquivo regular, o kernel retorna `ENOTDIR`. A captura conjunta evita o aborto precoce da gravação em staging.
  * **D2:** No `applyStaged`, a Fase 1 agora lê o modo de permissões (`st.mode`) do arquivo existente via `fs.stat` e armazena em `originalModes: Map<string, number>`. Na Fase 2, antes de executar `fs.rename` do arquivo temporário para o destino final, o código executa `fs.chmod(tempWritePath, origMode)`. Com isso, **permissões POSIX (como o bit executável `+x` / `0755` e permissões restritas `0600`) são integralmente preservadas** após edições de código.

### (5) E2/M07 e Testes Multiplataforma (S23 a S28)
* **Arquivos:** `test/mcp.test.ts`, `test/security-fs.test.ts`
* **Implementação:**
  * **M07 (`test/mcp.test.ts`):** O teste de ponto de entrada foi adaptado com ramificação de plataforma: executa as asserções de caminhos Windows (`C:\...`, unidades maiúsculas/minúsculas, barras invertidas e espaços) sob `process.platform === "win32"` e asserções POSIX equivalentes (`/home/user/...`) fora do Windows, além de checagens comuns (`undefined`, `""`, outro script) para todas as plataformas.
  * **S23 a S28 (`test/security-fs.test.ts`):** Adicionadas 6 novas suítes de teste de invariantes cobrindo:
    - **S23:** Bloqueio de pasta irmã com caixa diferente sob `caseInsensitive: false` (A1).
    - **S24:** Staging simultâneo e independente de `Arquivo.txt` e `arquivo.txt` sob `caseInsensitive: false` (A2).
    - **S25:** Permissão de nomes com `:` e nomes como `aux.c` e `con.h` sob `isWindows: false` (B2 e B4).
    - **S26:** Permissão de trailing dots (`ellipsis...`) e nomes com til (`backup~1.txt`) sob `isWindows: false` (B3 e B5).
    - **S27:** `writeFile` lida com colisão intermediária sem lançar exceção não-tratada de `ENOTDIR` (D1).
    - **S28:** `applyStaged` preserva permissões de execução `st_mode` (`0755`) (D2).

---

## 3. Resultados de Compilação e Testes (Windows)

* **Build TypeScript:**
  * Comando: `npm run build`
  * Resultado: Compilado com sucesso via `tsc` sem erros ou advertências.
* **Vitest (Windows x64):**
  * Comando: `npm test`
  * Arquivos de teste: **4 aprovados**
  * Total de testes: **56 testes aprovados (100% de sucesso)**
    - `test/mcp.test.ts`: 7 aprovados
    - `test/sandbox.test.ts`: 12 aprovados
    - `test/ripwire.test.ts`: 9 aprovados
    - `test/security-fs.test.ts`: 28 aprovados
  * Duração total: ~2.40s

---

## 4. Dúvidas e Considerações para o Teste no Linux (WSL)

1. **Binário do Ripwire no Linux:**
   * Caso o dono queira testar a inteligência de código (Ripwire) no Linux real futuramente, basta compilar ou baixar a release Linux ELF do `ripwire` e exportar `RIPWIRE_PATH=/caminho/para/ripwire`.
   * Enquanto não houver binário Linux configurado, o servidor MCP e todas as operações de sandbox e filesystem (leitura, escrita, staging, apply, regex) continuam 100% funcionais, e a suíte Vitest ignora automaticamente os testes de integração do Ripwire via `skipIf`.
2. **Ambiente macOS:**
   * O comportamento de `caseInsensitive` e `isWindows` foi atrelado por padrão a `process.platform === "win32"`. No macOS (darwin), o APFS padrão é case-insensitive por padrão (embora POSIX). Caso desejado no futuro, `caseInsensitive` pode adotar `process.platform === "win32" || process.platform === "darwin"`.
3. **Controle de Versão:**
   * Nenhum arquivo de documentação de relatório/parecer/handoff foi commitado.
   * `pi/`, `.agents/rules/codemode-policy.md` e `C:\Dev\Horus` permaneceram estritamente intocados.

---

## 5. Rodada 2 — Ajustes Pós-Revisão WSL

Após execução independente pelo Claude Code em Linux real (WSL, checkout limpo do HEAD, Node 24), foram identificados 2 pontos nos testes que foram corrigidos no commit:

* **Commit `1cc35bf`:** `test: isolate Windows-specific tests and restrict ripwire fallback to win32`
  * **Helper compartilhado (`test/helpers/ripwire.ts`):**
    - O checkout versiona `bin/ripwire-0.6.5-windows-x64/ripwire.exe`. No Linux, esse arquivo existe no disco, fazendo com que a checagem anterior `nodeFs.existsSync(localWinBin)` considerasse o Ripwire falsamente disponível no Linux e tentasse executar um executável PE x86_64, resultando em erro de spawn.
    - O helper agora restringe o fallback local estritamente a `process.platform === 'win32'`. No Linux, apenas `process.env.RIPWIRE_PATH` ou o binário no `PATH` ativam o Ripwire.
  * **MCP test (`test/mcp.test.ts`):**
    - O teste `M02` executa `ripwire.map` via sandbox; foi anotado com `it.skipIf(!isRipwireAvailable())` para não falhar em ambientes Linux desprovidos do binário ELF do Ripwire.
  * **Testes Win32 explícitos (`test/security-fs.test.ts`):**
    - Os testes **S03** (nomes DOS reservados), **S04** (Alternate Data Streams e caracteres Win32), **S05** (trailing dots e spaces) e **S17** (colisão de caixa `A.txt` vs `a.txt` no staging) originalmente usavam as opções padrão do construtor. No Linux, os padrões agora são POSIX (case-sensitive, sem restrições Win32), o que fazia esses testes de especificação Windows falharem.
    - Foram tornados explícitos com `{ isWindows: true, caseInsensitive: true }` no `PathPolicy` e `{ caseInsensitive: true }` no `createFsWriteTools`. Dessa forma, testam as regras Windows de forma idêntica em qualquer sistema operacional, coexistindo com os testes multiplataforma **S23 a S28**.
  * **Totais após Rodada 2 (Windows x64):**
    - Build: `npm run build` -> Sucesso (`tsc`, 0 erros)
    - Testes: `npm test` -> **56/56 testes aprovados** (4 test files)
      - `test/mcp.test.ts`: 7 aprovados
      - `test/sandbox.test.ts`: 12 aprovados
      - `test/ripwire.test.ts`: 9 aprovados
      - `test/security-fs.test.ts`: 28 aprovados

