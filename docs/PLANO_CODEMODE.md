# Plano de Implantação: Plugin Codemode para Google Antigravity

> **Status:** Concluído e Homologado (Fases 1 a 5)  
> **Autor / Parceria:** Antigravity Agent & Claude Code Review  
> **Data:** 02/10/2026  
> **Referência:** Pi 1.0 (`earendil-works/pi`), Ripwire (`redhat-et/ripwire`)

---

## 1. Sumário Executivo

Este plano formaliza a especificação arquitetural e as etapas de implementação de um **Plugin de Codemode** para o **Google Antigravity**. O objetivo primário é substituir o gargalo de múltiplos turnos de LLM (*tool calling* sequencial e verboso) por uma execução local, assíncrona e em lote de scripts JavaScript em um sandbox seguro em WebAssembly (**QuickJS**), complementado com o mapeador de grafos de chamada **Ripwire**.

### Benefícios Esperados
1. **Redução de Latência:** Agrupamento de dezenas de leituras, buscas e filtros em um único turno de inferência do modelo (de ~30s para <1s local).
2. **Economia de Contexto:** Dados intermediários (grandes saídas de arquivos, logs e JSONs) são filtrados na memória do script; apenas o resultado consolidado entra na janela de contexto do LLM.
3. **Tratamento de Exceções Local:** Capacidade de o agente usar `try/catch` e `Promise.allSettled` dentro do script para tratar erros sem consumir turnos adicionais de LLM.

### 1.1. Metodologia SDD e Papéis do Time
O desenvolvimento é regido pela metodologia **Spec-Driven Development (SDD)**, com governança detalhada em [`docs/TIME_E_METODOLOGIA.md`](file:///c:/Dev/Joker/docs/TIME_E_METODOLOGIA.md):
* **Product Owner & Aceite Final:** Usuário (revisão de specs e aprovação de gates).
* **Engenheiro Líder & Arquiteto:** Antigravity (elaboração das specs, invariantes de teste e orquestração).
* **Codificador Econômico:** Subagentes `flash_lite` / `flash` (implementação estrita baseada nas specs).
* **Verificação Automatizada:** `tsc` e `vitest` ($0 custo de LLM).
* **Revisor de Código & Auditor de Segurança:** Claude Code (`claude` CLI - auditoria independente de segurança e concorrência).

---

## 2. Arquitetura da Solução

O plugin será empacotado na estrutura canônica do Antigravity em `.agents/plugins/codemode/`. A comunicação ocorre via **Model Context Protocol (MCP)** sobre `stdio`, onde o processo Node.js hospeda o motor QuickJS e atua como ponte segura para o sistema de arquivos local e utilitários nativos.

```mermaid
flowchart TD
    subgraph Antigravity ["Ambiente Antigravity"]
        LLM[Modelo LLM / Gemini]
        Rules["Rules (rules/AGENTS.md)"]
        Skill["Skill (skills/codemode/SKILL.md)"]
        Hook["Hook (hooks.json)"]
    end

    subgraph Plugin ["Plugin: .agents/plugins/codemode/"]
        MCPServer["Servidor MCP (Node.js stdio)"]
        
        subgraph Host ["Thread Host (Node.js)"]
            SecLayer["Camada de Contenção de Caminhos (Windows)"]
            Staging["Staging Atômico de Escrita / Diff Engine"]
            RipwireEngine["Ripwire Subprocess Bridge"]
            FSEngine["Filesystem Engine Nativo (fs/promises)"]
        end

        subgraph Sandbox ["Worker Thread Isolado"]
            QJS["QuickJS VM (WASM Instance)"]
            Prelude["prelude.js (tools, text, image, store, console)"]
            Script["Script JS Gerado pelo LLM"]
        end
    end

    LLM -->|"CallTool('codemode_run', { code })"| MCPServer
    MCPServer --> Host
    Host -->|"Inicia Worker & SharedArrayBuffer"| Sandbox
    Sandbox -->|"bridge('call', toolName, args)"| Host
    Host --> SecLayer
    SecLayer --> FSEngine
    SecLayer --> Staging
    SecLayer --> RipwireEngine
    Host -->>|"bridge('result', payload)"| Sandbox
    Sandbox -->>|"bridge('done', output)"| Host
    MCPServer -->>|"Retorno consolidado (texto + diffs)"| LLM
```

---

## 3. Estrutura de Arquivos do Plugin

```text
.agents/plugins/codemode/
├── plugin.json                 # Manifesto do plugin no Antigravity
├── mcp_config.json             # Registro do servidor MCP local
├── rules/
│   └── AGENTS.md               # Diretrizes operacionais para o agente priorizar Codemode
├── skills/
│   └── codemode/
│       └── SKILL.md            # Receitas de código, tipagens completas e guia de uso
├── hooks.json                  # Lifecycle hook consultivo (evita loops individuais repetitivos)
└── server/                     # Servidor Node.js / TypeScript
    ├── package.json
    ├── tsconfig.json
    ├── wasm/
    │   └── quickjs.wasm        # Binário WebAssembly do QuickJS
    └── src/
        ├── index.ts            # Servidor MCP (protocolo stdio)
        ├── sandbox/
        │   ├── host.ts         # Orquestrador de Worker, timeouts e interrupção atômica
        │   ├── worker.ts       # Worker thread que inicializa a VM QuickJS
        │   ├── protocol.ts     # Tipagem das mensagens IPC entre Host e Worker
        │   └── prelude.ts      # JavaScript interno injetado antes do script do usuário
        ├── security/
        │   └── path-policy.ts  # Validador de contenção estrita no Windows
        └── tools/
            ├── fs-read.ts      # readFile, glob, grep (ripgrep)
            ├── fs-write.ts     # writeFile e editFile com staging em memória
            └── ripwire.ts      # Wrapper para consultas de símbolos e blast radius
```

---

## 4. Fases de Implantação

### Fase 1: Scaffold e Núcleo do Sandbox QuickJS WASM
* **Objetivo:** Estabelecer o motor isolado de execução JavaScript em Worker Thread com controle rígido de recursos.
* **Tarefas Técnicas:**
  1. Configurar o monorepo TypeScript sob `.agents/plugins/codemode/server`.
  2. Integrar o pacote `quickjs-wasi` com o binário `quickjs.wasm` (extraído de `pi/packages/codemode`).
  3. Implementar a classe `Execution` em [host.ts](file:///c:/Dev/Joker/pi/packages/codemode/src/runtime/host.ts) com `SharedArrayBuffer` de 4 bytes para interrupção imediata via `Atomics.store`.
  4. Implementar o [worker.ts](file:///c:/Dev/Joker/pi/packages/codemode/src/runtime/worker.ts) com shim WASI que descarta saídas de `fd_write` para evitar corrupção de terminais.
  5. Injetar o `prelude.js` contendo Proxies inteligentes com mensagens explicativas para digitação incorreta de ferramentas (*"Did you mean tools.readFile?"*), além dos helpers `text()`, `image()`, `store()`, `load()` e `exit()`.
  6. Preservar o mapeamento exato de linhas de erro para facilitar a autocorreção do modelo.

### Fase 2: Segurança e Contenção de Filesystem para Windows
* **Objetivo:** Permitir acesso de leitura e escrita ao workspace local garantindo isolamento absoluto contra fugas de diretório ou explorações no Windows.
* **Tarefas Técnicas:**
  1. **Políticas de Caminho em `path-policy.ts`:**
     - Resolução canônica via `path.resolve` + `fs.realpath`.
     - Verificação de contenção com `path.relative` estrita (sem confiar em `startsWith`).
     - Comparação *case-insensitive* padronizada para Windows.
     - Bloqueio rígido de:
       - Caminhos UNC (`\\server\share`) e caminhos estendidos (`\\?\`).
       - Nomes reservados do MS-DOS (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`).
       - *Alternate Data Streams* (`arquivo:stream`).
       - Symlinks e Junctions que apontem para fora do workspace.
       - Nomes curtos no padrão 8.3 (`PROGRA~1`).
     - Proteção por padrão de `.env`, `.git/` e chaves privadas.
  2. **Ferramentas de Leitura:**
     - `tools.readFile({ path, offset?, limit? })`: Leitura de arquivos com limite de tamanho seguro.
     - `tools.glob({ pattern, ignore? })`: Busca rápida de arquivos respeitando `.gitignore`.
     - `tools.grep({ pattern, path?, regex? })`: Varredura de conteúdo via binário ripgrep (`rg.exe`) com limite de linhas.
  3. **Escrita Segura com Staging Atômico (`fs-write.ts`):**
     - `tools.writeFile({ path, content })` e `tools.editFile({ path, oldText, newText })` não alteram o disco imediatamente; registram as mutações em memória (staging).
     - Geração de *diff unificado* retornado no sumário final da execução para inspeção do usuário.
     - Suporte a flag de confirmação/aplicação atômica (`apply: true`).

### Fase 3: Integração do Motor de Contexto Ripwire
* **Objetivo:** Disponibilizar o grafo de chamada determinístico e o raio de impacto de símbolos dentro dos scripts.
* **Tarefas Técnicas:**
  1. Integrar o executável nativo Windows `ripwire.exe` (localizado em `c:\Dev\Joker\bin\ripwire-0.6.5-windows-x64\ripwire.exe`).
  2. Implementar ferramentas nativas expostas no objeto `tools.ripwire`:
     - `tools.ripwire.map({ path })`: Retorna o mapa ordenado de símbolos e PageRank.
     - `tools.ripwire.callers({ symbol })`: Lista todos os chamadores de 1 salto de um símbolo.
     - `tools.ripwire.uses({ symbol })`: Locais exatos de uso no código.
     - `tools.ripwire.impact({ symbol })`: Avalia o *blast radius* (potencial de quebra) de uma alteração.
  3. Execução assíncrona com timeout estrito de subprocesso (máximo 15 segundos).

### Fase 4: Servidor MCP e Protocolo Stdio
* **Objetivo:** Expor a capacidade para o Antigravity como uma ferramenta MCP nativa e estável.
* **Tarefas Técnicas:**
  1. Implementar o servidor MCP sobre `@modelcontextprotocol/sdk` em `index.ts`.
  2. Registrar a ferramenta principal:
     ```typescript
     server.tool(
       "codemode_run",
       "Executa um script assíncrono em JavaScript para realizar leituras em lote, buscas com Ripwire e transformações no workspace em um único turno.",
       {
         code: z.string().describe("Código JavaScript assíncrono a executar no sandbox.")
       },
       async ({ code }) => executeCodemode(code)
     );
     ```
  3. Redirecionar todo log ou depuração exclusivamente para `stderr` (para não violar a comunicação JSON-RPC em `stdout`).
  4. Configurar `mcp_config.json` com caminhos relativos ao plugin.

### Fase 5: Ativação, Rules e Skills no Antigravity
* **Objetivo:** Ensinar o agente a selecionar o Codemode estrategicamente e orientar sua escrita de scripts.
* **Tarefas Técnicas:**
  1. **Regras Contextuais em `rules/AGENTS.md`:**
     - Definir cenários claros de ativação:
       - *Usar Codemode quando:* precisar inspecionar 2 ou mais arquivos, realizar varreduras com Ripwire, auditar referências cruzadas ou aplicar refatorações em lote.
       - *Usar ferramentas nativas quando:* for uma leitura simples de 1 arquivo pontual ou edição cirúrgica em um único local.
  2. **Skill Didática em `skills/codemode/SKILL.md`:**
     - Contrato completo das funções (`declare const tools: ...`).
     - Exemplos práticos (*snippets*) para o modelo replicar:
       - Exemplo 1: Buscar arquivos e extrair dados específicos com `Promise.all`.
       - Exemplo 2: Mapear chamadores de uma função com Ripwire antes de refatorar.
       - Exemplo 3: Aplicar substituições consistentes com `editFile` e staging.
  3. **Lifecycle Hook Consultivo em `hooks.json`:**
     - Configurar `PreInvocation` para sugerir agregação quando forem detectadas consultas sucessivas, mantendo política não-bloqueante para evitar loops de rejeição.

### Fase 6: Bateria de Testes e Validação
* **Objetivo:** Validar contenção de segurança, tolerância a falhas e ganho real de desempenho.
* **Casos de Teste Mandatórios:**
  1. **Segurança & Adversidade:**
     - Script com `while(true) {}` deve ser interrompido pelo timeout do host em <2s.
     - Tentativas de alocação de memória excessiva (`'x'.repeat(2**30)`) devem lançar erro de OOM sem derrubar o Node.js.
     - Tentativa de leitura fora da raiz do workspace (`../../Windows/win.ini`, caminhos UNC ou symlinks externos) deve ser rejeitada com `SecurityError`.
  2. **Benchmark Empírico:**
     - Executar tarefa de auditoria: identificar todos os chamadores de `CodemodeSandbox` e inspecionar seus testes.
     - Medir: tempo total decorrido, número de turnos de LLM e consumo total de tokens versus fluxo nativo tradicional.

---

## 5. Critérios de Aceitação e Definição de Pronto (DoD)

| Critério | Meta / Validação |
| :--- | :--- |
| **Isolamento de Processo** | Script em loop infinito morre sem consumir >256 MB de RAM e sem bloquear o servidor MCP. |
| **Integridade de Caminhos** | 100% dos testes de path traversal e vetores Windows bloqueados com sucesso. |
| **Integração Ripwire** | Chamadas `tools.ripwire.callers` retornam resultados determinísticos em <500ms. |
| **Staging Seguro** | Mutações de escrita geram diff legível sem alterar o disco até confirmação. |
| **Desempenho** | Redução mínima de 60% no tempo total de tarefas exploratórias multi-arquivo. |
| **Autocorreção** | Erros de sintaxe ou execução no script contêm número de linha exato e mensagem descritiva. |

---

## 6. Próxima Ação Imediata

Iniciar a **Fase 1 (Scaffold e Motor do Sandbox)** criando a estrutura em `.agents/plugins/codemode/server` e configurando a compilação do QuickJS WASM no Node.js.
