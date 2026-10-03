# Relatório de Diagnóstico e Correção: Guarda de Ponto de Entrada MCP no Windows

> **Autor:** Antigravity (agy)  
> **Data:** 03/10/2026  
> **Branch de Trabalho:** `fix/codemode-mcp-windows-guard`  
> **Commit da Correção:** `cecbd3b` (`fix(mcp): normalize entry point guard for Windows paths`)  
> **Documento de Referência:** `docs/codemode-bug-handoff.md`  

---

## 1. Resultado da Reprodução Independente (Antes e Depois)

### 1.1. Antes da Correção (Estado Inicial)

1. **Execução direta do `server.js`:**
   * Comando: `node c:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js`
   * **Comportamento observado:** O processo finalizou imediatamente com código `0`, sem qualquer saída em stdout/stderr e sem aguardar comandos no stdin.
   * **Envio de payload JSON-RPC (`initialize`):** Ao enviar a requisição por pipe stdin, o processo encerrou com exit code `0` sem produzir nenhuma resposta.

2. **Execução com import dinâmico e chamada explícita de `runServer()`:**
   * Comando:
     ```powershell
     $init = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
     $init | node -e "import('file:///C:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js').then(m=>m.runServer())"
     ```
   * **Comportamento observado:** Resposta JSON-RPC imediata com sucesso:
     ```json
     {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"antigravity-codemode","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
     ```

### 1.2. Depois da Correção (Com `dist` Recompilado)

1. **Execução direta com handshake MCP completo (`initialize`, `notifications/initialized`, `tools/list`):**
   * Comando:
     ```powershell
     $requests = @'
     {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-client","version":"1.0"}}}
     {"jsonrpc":"2.0","method":"notifications/initialized"}
     {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
     '@
     $requests | node c:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js
     ```
   * **Resultado observado:**
     ```json
     {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"antigravity-codemode","version":"1.0.0"}},"jsonrpc":"2.0","id":1}
     {"result":{"tools":[{"name":"codemode_run","description":"Executa código JavaScript no sandbox QuickJS do Codemode com acesso ao filesystem e navegação estrutural Ripwire. Mutações de escrita são mantidas em staging.","inputSchema":{...}},{"name":"codemode_apply","description":"Aplica atomicamente no disco real todas as alterações mantidas na área de staging geradas pelo codemode_run.","inputSchema":{...}},{"name":"codemode_discard","description":"Descarta todas as alterações mantidas na área de staging sem modificar o disco.","inputSchema":{...}}]},"jsonrpc":"2.0","id":2}
     ```

2. **Variações de Invocação de Caminho no Windows validadas:**
   * Caminho relativo com barras invertidas (`.agents\plugins\codemode\server\dist\mcp\server.js`): **Sucesso** (`initialize` respondido).
   * Caminho relativo com barras normais (`.agents/plugins/codemode/server/dist/mcp/server.js`): **Sucesso** (`initialize` respondido).
   * Caminho absoluto com unidade maiúscula (`C:\Dev\Joker\...`): **Sucesso** (`initialize` respondido).
   * Caminho absoluto com unidade minúscula (`c:\dev\joker\...`): **Sucesso** (`initialize` respondido).

3. **Comportamento Passivo sob Importação:**
   * Ao importar o módulo via `node -e "import('...server.js')"` sem chamar `runServer()`, o processo encerra sem iniciar um servidor espúrio (`isMainModule` avalia para `false` pois `process.argv[1]` é indefinido em `node -e`).

---

## 2. Causa Confirmada e Diagnóstico Técnico

A hipótese levantada no handoff foi **100% confirmada**.

* No arquivo original `src/mcp/server.ts`, a verificação de ponto de entrada era:
  ```ts
  if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`)
  ```
* No Windows:
  * `import.meta.url` no Node ESM produz um URI formatado com 3 barras: `file:///C:/Dev/...`
  * A string concatenada gerava apenas 2 barras: `file://C:/Dev/...`
  * A comparação de igualdade estrita (`===`) falhava invariavelmente, fazendo com que o script pulasse o bloco `runServer()` e terminasse silenciosamente com código de saída `0`.

---

## 3. Como o Antigravity Inicia o Servidor e Status na Sessão

* **Mecanismo de Descoberta e Inicialização:**
  * O Antigravity consulta as configurações em `.agents/mcp_config.json` e `.agents/plugins/codemode/plugin.json`.
  * Ambas as configurações declaram:
    ```json
    {
      "command": "node",
      "args": ["c:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js"],
      "env": {
        "RIPWIRE_PATH": "c:/Dev/Joker/bin/ripwire-0.6.5-windows-x64/ripwire.exe"
      }
    }
    ```
  * O Language Server do Antigravity inicializa processos MCP em stdio durante o startup da sessão e dispara o handshake `initialize` e `tools/list` para descoberta dinâmica de ferramentas.
* **Diagnóstico da Sessão do Antigravity (agy):**
  * Na sessão atual, `codemode_run`, `codemode_apply` e `codemode_discard` **não estavam presentes** na lista de ferramentas declaradas do agente.
  * Verificou-se que não havia nenhum processo `node.exe` em execução servindo o MCP.
  * **Motivo:** Devido à falha no guarda antes da correção, ao tentar subir o processo MCP do `codemode`, o Node saía imediatamente com código `0`, impedindo a descoberta das ferramentas pelo Antigravity.

---

## 4. Resumo do Diff e Commit

* **Commit:** `cecbd3b`
* **Mensagem:** `fix(mcp): normalize entry point guard for Windows paths`
* **Arquivos modificados:**
  1. `src/mcp/server.ts`:
     * Importação de `fileURLToPath` e `pathToFileURL` de `node:url`.
     * Criação e exportação da função auxiliar `isMainModule(metaUrl: string, argv1?: string): boolean`, que:
       - Trata `argv1` indefinido ou vazio retornando `false`.
       - Compara `pathToFileURL(argv1).href === metaUrl`.
       - Normaliza caminhos no Windows (`fileURLToPath(metaUrl)` vs `path.resolve(argv1)`) com comparação *case-insensitive* para tolerar diferenças de maiúsculas/minúsculas na letra da unidade (ex: `C:` vs `c:`).
     * Atualização do bloco condicional de inicialização:
       ```ts
       if (isMainModule(import.meta.url, process.argv[1])) {
         runServer().catch((error) => {
           console.error("Falha fatal no Servidor MCP Codemode:", error);
           process.exit(1);
         });
       }
       ```
  2. `test/mcp.test.ts`:
     * Adicionado teste unitário `M07: isMainModule detecta ponto de entrada no Windows (unidade maiúscula/minúscula, barras, espaços)` cobrindo:
       - Unidade em maiúscula e barras invertidas (`\`).
       - Variação com unidade minúscula no `argv`.
       - Variação com unidade maiúscula no `argv` e minúscula na URL.
       - Barras normais (`/`).
       - Caminhos contendo espaços (ex: `C:\Program Files\Meu Agente\server.js`).
       - `argv[1]` indefinido (`undefined`) ou string vazia (`""`).
       - Script diferente (`other-script.js`), garantindo que avalie para `false`.

---

## 5. Resultados de Build e Testes

* **Build:**
  * Comando: `npm run build`
  * Resultado: Compilação TypeScript (`tsc`) concluída com **0 erros**, gerando artefatos atualizados em `dist/mcp/server.js`.
* **Testes Automatizados (Vitest v3.2.7):**
  * Comando: `npm test`
  * Arquivos de teste: **4 aprovados** (`test/mcp.test.ts`, `test/sandbox.test.ts`, `test/ripwire.test.ts`, `test/security-fs.test.ts`)
  * Total de testes: **49 testes** (todos aprovados, **0 falhas**)
  * Tempo de execução: ~2.40s

---

## 6. Verificação de Efeitos Colaterais

1. **Outros usos de `import.meta.url` ou `process.argv`:**
   * Varredura realizada em todo o diretório `src/`:
     - `src/sandbox/host.ts`: `new URL(..., import.meta.url)` para carregar `worker.js`.
     - `src/sandbox/wasm.ts`: `createRequire(import.meta.url).resolve(...)` para carregar binário WASM.
     - `src/tools/regex-matcher.ts`: `new URL(..., import.meta.url)` para carregar `regex-worker.js`.
   * Nenhum outro local utiliza `process.argv` ou comparações frágeis de ponto de entrada.
2. **Validação de Configurações:**
   * `.agents/mcp_config.json`: Sintaxe JSON válida, configuração de comando e `RIPWIRE_PATH` íntegros.
   * `.agents/plugins/codemode/plugin.json`: Sintaxe JSON válida, manifesto do plugin íntegro.

---

## 7. Perguntas em Aberto para Decisão do Dono

1. **Ativação das ferramentas na sessão do Antigravity:**
   * Como o Antigravity inicializa ferramentas MCP no startup do processo/sessão, para que as ferramentas `codemode_run`, `codemode_apply` e `codemode_discard` fiquem ativas no painel de ferramentas do agente, será necessário reiniciar a sessão do Antigravity (ou reabrir o workspace) após a homologação?
2. **Configuração Global vs Local:**
   * O arquivo de configuração global `C:\Users\mjabb\.gemini\config\mcp_config.json` atualmente possui `"mcpServers": {}`. O servidor `codemode` está configurado no workspace local (`C:\Dev\Joker\.agents\mcp_config.json`). O dono deseja registrar o servidor também na configuração global para todos os projetos ou mantê-lo apenas via workspace/plugin?
