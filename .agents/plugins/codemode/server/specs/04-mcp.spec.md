# Spec 04: MCP Server Protocol & Codemode Tool Entrypoints

> **Fase:** 4 (Servidor MCP e Ferramentas Principais)  
> **Status:** Elaborada  
> **Componente:** `server/src/mcp/`  
> **SDK Base:** `@modelcontextprotocol/sdk` (v1.6.0) + `zod`  
> **Protocolo:** MCP Stdio JSON-RPC

---

## 1. Objetivo e Arquitetura

Esta especificação define o Servidor Model Context Protocol (MCP) que expõe o ambiente **Codemode** para o Antigravity e outros clientes MCP.
O servidor orquestra:
1. O Sandbox QuickJS WASM (`CodemodeSandbox`).
2. A camada de segurança e filesystem Windows (`PathPolicy`, `fs-read`, `fs-write`).
3. O motor de inteligência de código (`ripwire`).

O fluxo de modificação de código opera estritamente no modelo **Staging-first**:
1. O modelo escreve um script que usa `tools.writeFile` ou `tools.editFile` dentro do sandbox.
2. Todas as mutações são mantidas em memória (área de staging).
3. `codemode_run` retorna a execução junto com o `stagedDiff` gerado.
4. O cliente ou o usuário aprova o diff chamando `codemode_apply` para persistir as alterações atomicamente no disco real.

---

## 2. Ferramentas MCP Expostas

### 2.1. `codemode_run`
Executa código JavaScript no sandbox seguro do Codemode com acesso ao filesystem e ripwire.
- **Parâmetros (`zod`)**:
  - `code` (string): Código JavaScript assíncrono a executar no sandbox.
  - `timeoutMs` (number, opcional): Tempo limite de execução em milissegundos (padrão: 60.000ms).
- **Retorno (`CallToolResult`)**:
  - `content`: Array de itens de conteúdo (`{ type: "text", text: string }`).
  - Formato do texto gerado:
    - Resultado retornado pela expressão ou função.
    - Saída de console (`console.log`, `text()`).
    - Diffs unificados de arquivos em staging (se houver mutações pendentes).
    - Metadados de execução: chamadas de ferramentas realizadas, status e duração.

### 2.2. `codemode_apply`
Aplica atomicamente todas as alterações atualmente retidas em staging no disco físico.
- **Parâmetros**: Nenhum obrigatório.
- **Retorno**: Lista de caminhos relativos de arquivos gravados com sucesso no disco.

### 2.3. `codemode_discard`
Descarta e limpa todas as alterações pendentes na área de staging.
- **Parâmetros**: Nenhum obrigatório.
- **Retorno**: Confirmação de descarte (`"Staging limpo com sucesso."`).

---

## 3. Invariantes de Teste Obrigatórios (`test/mcp.test.ts`)

- **M01**: Servidor MCP inicializa e responde à listagem de ferramentas (`tools/list`).
- **M02**: `codemode_run` executa script simples (ex: `1 + 1` ou `return 42`) e retorna o resultado correto.
- **M03**: `codemode_run` executa leitura de arquivo via `tools.readFile` e navegação via `tools.ripwire.map`.
- **M04**: Mutações via `tools.writeFile` produzem diff no retorno do `codemode_run` sem alterar o disco antes do apply.
- **M05**: `codemode_apply` grava as alterações pendentes no disco com integridade atômica.
- **M06**: `codemode_discard` limpa o staging e garante que o disco permaneça inalterado.
- **M07**: Scripts com erro sintático ou tempo limite estourado retornam erro MCP amigável sem derrubar o processo do servidor.
