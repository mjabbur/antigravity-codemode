# Spec 03: Ripwire Code Intelligence Integration

> **Fase:** 3 (Mapeamento Sintático e Navegação em Milissegundos)  
> **Status:** Elaborada para Homologação  
> **Componente:** `server/src/tools/ripwire.ts`  
> **Binário Base:** `c:\Dev\Joker\bin\ripwire-0.6.5-windows-x64\ripwire.exe`  
> **Referência:** Ripwire v0.6.5 (PageRank de Símbolos, Ego Graph, Blast Radius)

---

## 1. Objetivo e Escopo

Esta especificação define a ponte de integração entre o motor **Codemode** e a ferramenta nativa de inteligência de código **Ripwire** (`ripwire.exe`).
O objetivo é fornecer aos scripts executados no sandbox capacidade de navegação estrutural completa (mapa de símbolos com PageRank, ego-graph, chamadores diretos, usos globais e cálculo de blast radius / impacto transitivo) em milissegundos e com zero consumo prévio de contexto do LLM.

---

## 2. Requisitos de Segurança e Execução de Processo

1. **Execução Direta Sem Shell**:
   - O binário DEVE ser disparado diretamente via `child_process.execFile` ou `child_process.spawn`.
   - É ESTRITAMENTE PROIBIDO o uso de `exec()` ou qualquer invocação através de `cmd.exe` ou `powershell.exe` para mitigar qualquer possibilidade de Command Injection.
   
2. **Confinamento de Caminhos (PathPolicy)**:
   - Todo diretório ou arquivo repassado como alvo do `ripwire` DEVE ser pré-validado por `PathPolicy.resolvePath(target, "read")`.
   - Tentativas de apontar o ripwire para caminhos UNC, fora do workspace ou diretórios sensíveis (.git, .aws, .ssh) DEVEM ser rejeitadas com `SecurityError`.

3. **Sanitização de Símbolos**:
   - Os identificadores de símbolos (`symbol`) passados para `--callers=`, `--impact=`, `--uses=`, etc., devem ser strings não-vazias e sem quebras de linha (`\r`, `\n`) ou bytes nulos (`\0`).

4. **Timeouts e Limite de Buffer**:
   - Timeout padrão de 15 segundos por invocação (ajustável via opções).
   - Limite de buffer de stdout (`maxBuffer`) de 10 MB para evitar estouro de memória no Node.js.
   - Cancelamento ativo: quando o `AbortSignal` for disparado (seja por timeout ou abort do usuário), o processo filho DEVE ser finalizado imediatamente com `child.kill("SIGTERM")` seguido de `"SIGKILL"` se necessário.

---

## 3. Contratos de Ferramentas (`ripwire.ts`)

As ferramentas devem ser exportadas através de `createRipwireTools(policy: PathPolicy, options?: RipwireOptions): CodemodeTool[]`.

### 3.1. `ripwire.map`
Mapeia a estrutura de código com ranking Personalized PageRank.
- **Entrada (`inputSchema`)**:
  - `path` (string, opcional): Caminho relativo ou absoluto dentro do workspace (padrão: `policy.workspaceRoot`).
  - `topK` (number, opcional): Número máximo de símbolos principais a retornar (padrão: 100).
  - `maxTokens` (number, opcional): Orçamento de tokens para auto-balancear o mapa de símbolos.
  - `json` (boolean, opcional, padrão: `true`): Emite JSON estruturado.
- **Saída**: Objeto JSON com as estatísticas do repositório (`files`, `symbols`, `edges`), raízes e array de arquivos com seus símbolos classificados (`r: [{ p: string, s: [...] }]`).

### 3.2. `ripwire.for` (Task Lens)
Fornece um bundle focado especificamente na tarefa que o modelo está executando.
- **Entrada (`inputSchema`)**:
  - `task` (string, obrigatório): Descrição em linguagem natural da tarefa a ser realizada.
  - `path` (string, opcional): Diretório alvo.
  - `signaturesOnly` (boolean, opcional): Se verdadeiro, omite os corpos das funções e traz apenas assinaturas.
- **Saída**: Objeto ou string com as entidades e rotas conceituais mais relevantes para a tarefa.

### 3.3. `ripwire.callers`
Localiza todos os chamadores diretos (in-edges de 1 salto) de um símbolo.
- **Entrada (`inputSchema`)**:
  - `symbol` (string, obrigatório): Nome do identificador/método (ex: `"resolvePath"` ou `"PathPolicy.resolvePath"`).
  - `path` (string, opcional): Diretório base para a busca.
- **Saída**: Objeto com `callers: Array<{ t: string, n: string, p: string }>` onde `p` é `arquivo:linha`.

### 3.4. `ripwire.uses`
Localiza todos os usos de um símbolo no repositório (leituras, escritas, herança, chamadas).
- **Entrada (`inputSchema`)**:
  - `symbol` (string, obrigatório): Nome do identificador.
  - `path` (string, opcional): Diretório base.
- **Saída**: Objeto com `uses: Array<{ t: string, n: string, p: string, kind?: string }>`.

### 3.5. `ripwire.impact` (Blast Radius)
Calcula todo o grafo transitivo que alcança o símbolo, revelando o impacto real antes de uma refatoração.
- **Entrada (`inputSchema`)**:
  - `symbol` (string, obrigatório): Nome do símbolo a analisar.
  - `path` (string, opcional): Diretório base.
- **Saída**: Objeto contendo `impact: Array<{ t: string, n: string, p: string }>` e `import_reach: Array<{ via: string, p: string }>`.

---

## 4. Invariantes de Teste Obrigatórios (`test/ripwire.test.ts`)

- **R01**: `ripwire.map` mapeia o código em `src/` e retorna JSON válido contendo arquivos e nós de símbolos.
- **R02**: `ripwire.callers` localiza os chamadores reais de funções internas (ex: `resolvePath`).
- **R03**: `ripwire.impact` calcula o raio de alcance transitivo e identifica os arquivos que importam o módulo.
- **R04**: `ripwire.for` retorna contexto e símbolos relevantes para uma query de tarefa (ex: "read file with security").
- **R05**: `PathPolicy` bloqueia caminhos fora do workspace ou arquivos sensíveis passados como alvo do ripwire.
- **R06**: Cancelamento via `AbortSignal` encerra o processo sem vazamento de handles ou processos órfãos.
- **R07**: Sanitização de símbolos rejeita inputs maliciosos contendo quebras de linha ou caracteres nulos.
