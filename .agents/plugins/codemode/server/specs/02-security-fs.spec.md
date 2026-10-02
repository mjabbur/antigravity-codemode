# Spec 02: Camada de Segurança, Contenção de Caminhos e Filesystem com Staging no Windows

> **Fase:** 2 (Segurança e Filesystem Windows)  
> **Status:** Aprovada para Codificação  
> **Componentes:** `server/src/security/` e `server/src/tools/`  
> **Ambiente Alvo:** Windows 11 / Node.js v24  

---

## 1. Objetivo e Escopo

Esta especificação define:
1. A **política de contenção estrita de caminhos** (`PathPolicy`) específica para o Windows, garantindo que nenhum script executado no sandbox consiga ler ou escrever fora do workspace delimitado.
2. As **ferramentas de leitura** do filesystem (`readFile`, `glob`, `grep`).
3. O **motor de escrita segura com Staging em Memória e Diff Unificado** (`writeFile`, `editFile`, `getStagedDiff`, `applyStaged`), assegurando que escritas não ocorram de forma cega ou destrutiva.
4. O ajuste das ressalvas de entrada da Fase 1 (`Buffer.byteLength` e sanitização de `timeoutMs: Infinity`).

---

## 2. Contrato de Segurança e Contenção de Caminhos (`path-policy.ts`)

A classe `PathPolicy` é o guardião obrigatório de qualquer operação de I/O de disco.

### 2.1. Regras de Validação no Windows:
1. **Raiz Canônica:** O workspace deve ser resolvido via `path.resolve(workspaceRoot)` e normalizado.
2. **Resolução de Caminho:**
   - Todo caminho de entrada relativo deve ser resolvido em relação à raiz do workspace.
   - Para arquivos existentes, resolve symlinks e junctions com `fs.realpathSync`.
   - O caminho resolvido não pode escapar da raiz:
     ```typescript
     const rel = path.relative(this.workspaceRoot.toLowerCase(), resolved.toLowerCase());
     if (rel.startsWith("..") || path.isAbsolute(rel)) {
       throw new SecurityError(`Acesso negado: o caminho "${inputPath}" está fora do workspace.`);
     }
     ```
3. **Bloqueio de Vetores Específicos do Windows:**
   - **Caminhos UNC:** Rejeitar qualquer caminho que inicie com `\\` ou `//` (ex: `\\server\share`).
   - **Prefixos de Dispositivo Win32:** Rejeitar `\\?\` ou `\??\`.
   - **Nomes de Dispositivos Reservados do DOS:** Bloquear nomes reservados independentemente da extensão ou caixa (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`). Ex: `CON.txt`, `aux.json`, `subdir/nul.md`.
   - **Alternate Data Streams (ADS):** Rejeitar qualquer caminho contendo `:` após o drive letter (ex: `arquivo.txt:stream`).
   - **Nomes Curtos 8.3:** Bloquear caminhos contendo tilde seguido de dígitos indicando alias 8.3 (ex: `PROGRA~1`), forçando o uso de nomes canônicos longos.
4. **Proteção de Arquivos Sensíveis por Padrão:**
   - Bloquear acesso de escrita ao diretório `.git/`, `.gitattributes`, `.gitignore`.
   - Bloquear leitura e escrita de arquivos de segredos (`.env*`, `id_rsa*`, `*.pem`, `*.key`).

---

## 3. Contrato das Ferramentas de Leitura (`fs-read.ts`)

Todas as ferramentas operam sob a `PathPolicy`.

### 3.1. `readFile(args: { path: string, offset?: number, limit?: number, encoding?: string })`
* **Entrada:** Caminho relativo ou absoluto (dentro do workspace).
* **Parâmetros:**
  - `offset`: Posição inicial em bytes (padrão: 0).
  - `limit`: Máximo de bytes a ler (padrão: 512 KiB; teto máximo: 5 MiB).
  - `encoding`: `utf-8` (padrão) ou `base64`.
* **Saída:** String com o conteúdo lido.
* **Erros:** Lança erro claro se o arquivo não existir ou se for um diretório.

### 3.2. `glob(args: { pattern: string, cwd?: string, ignore?: string[] })`
* **Entrada:** Padrão glob (ex: `src/**/*.ts`).
* **Comportamento:**
  - Ignora automaticamente `node_modules` e `.git` a menos que explicitamente solicitado.
  - Retorna caminhos relativos ao workspace, com barras normais `/` (padrão POSIX).
* **Saída:** `string[]` ordenada.

### 3.3. `grep(args: { query: string, path?: string, isRegex?: boolean, caseSensitive?: boolean })`
* **Entrada:** Texto ou padrão regex a buscar.
* **Saída:** `Array<{ file: string, line: number, text: string }>` limitado a 500 ocorrências.

---

## 4. Contrato das Ferramentas de Escrita com Staging (`fs-write.ts`)

Para evitar corrupção de arquivos ou escritas acidentais pelo modelo, o Codemode adota o padrão **Two-Phase Write (Staging em Memória + Diff)**.

```typescript
export interface StagedFile {
  originalContent: string | null; // null se arquivo for novo
  newContent: string;
  isDeleted?: boolean;
}
```

### 4.1. Operações em Staging:
* **`tools.writeFile({ path: string, content: string })`**:
  - Valida o caminho na `PathPolicy`.
  - Se o arquivo já existir no disco e não estiver em staging, lê o conteúdo original.
  - Grava no mapa de staging em memória.
* **`tools.editFile({ path: string, oldText: string, newText: string })`**:
  - Lê o conteúdo do arquivo (do staging se já modificado, ou do disco).
  - Exige correspondência única de `oldText` (se casar 0 ou mais de 1 vez, rejeita com erro explicativo).
  - Aplica a substituição e mantém em staging.
* **`tools.getStagedDiff()`**:
  - Gera um patch no formato **Unified Diff** (`diff -u`) para cada arquivo em staging.
  - Permite ao script e ao modelo inspecionarem exatamente o que mudou.
* **`tools.applyStaged()`**:
  - Grava no disco atômica e sequencialmente todos os arquivos em staging.
  - Limpa a área de staging.
  - Retorna a lista de arquivos gravados.
* **`tools.discardStaged()`**:
  - Descarta todas as alterações pendentes em staging.

---

## 5. Resolução das Ressalvas de Entrada da Fase 1

1. **Cálculo de Bytes em `host.ts`:**
   - Substituir `item.text.length` por `Buffer.byteLength(item.text, "utf-8")` na checagem de `MAX_OUTPUT_BYTES`.
2. **Capping de `timeoutMs`:**
   - Se `options.timeoutMs === Infinity`, forçar teto máximo de `MAX_TIMEOUT_MS = 2_147_483_647` ms no timer do Node para que chamadas através do MCP nunca fiquem sem deadline na prática.

---

## 6. Matriz de Testes de Invariantes (Fase 2)

| Teste | Descrição | Comportamento Esperado |
| :--- | :--- | :--- |
| **S01: Path Traversal** | Leitura com `../../windows/win.ini` | Rejeitado com `SecurityError` |
| **S02: Caminho UNC** | Acesso a `\\192.168.1.10\share\passwords.txt` | Rejeitado com `SecurityError` |
| **S03: Nomes DOS** | Acesso a `CON.txt` ou `nul` | Rejeitado com `SecurityError` |
| **S04: Alternate Streams**| Acesso a `safe.txt:hidden` | Rejeitado com `SecurityError` |
| **S05: Segredos (.env)** | Leitura/escrita de `.env` | Rejeitado com `SecurityError` |
| **S06: Leitura Normal** | `readFile("README.md")` | Retorna string exata do arquivo |
| **S07: Glob e Grep** | `glob("src/**/*.ts")` e `grep("CodemodeSandbox")` | Retorna lista correta e linhas casadas |
| **S08: Staging writeFile**| `writeFile("teste.txt", "abc")` | Arquivo NÃO aparece no disco imediatamente; aparece no diff |
| **S09: Staging editFile** | `editFile("teste.txt", "abc", "xyz")` | Altera em staging; diff reflete a alteração |
| **S10: Apply Staged** | `applyStaged()` | Grava no disco atômico e confirma existência |
| **S11: Discard Staged** | `discardStaged()` | Limpa staging sem afetar o disco |
| **S12: Match Múltiplo** | `editFile` com padrão duplicado | Lança erro exigindo correspondência única |
