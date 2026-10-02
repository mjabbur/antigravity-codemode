# Antigravity Codemode ⚡

[![Vitest Tests](https://img.shields.io/badge/tests-48%20passing%20(100%25)-success)](file:///c:/Dev/Joker/.agents/plugins/codemode/server/test)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7%20NodeNext-blue)](file:///c:/Dev/Joker/package.json)
[![QuickJS WASM](https://img.shields.io/badge/Engine-QuickJS%20WASI-orange)](https://github.com/justjake/quickjs-emscripten)
[![Ripwire Inside](https://img.shields.io/badge/Code%20Intelligence-Ripwire%20v0.6.5-purple)](https://github.com/redhat-et/ripwire)
[![MCP Protocol](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20v1.6-green)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Mapeamento de código em sub-segundos, análise de blast radius via Personalized PageRank e refatoração atômica multi-arquivo para o Google Antigravity.**

---

## 🎯 Por que o Codemode?

Modelos de linguagem tradicionais interagem com repositórios através de dezenas de chamadas de ferramentas sequenciais na nuvem (*tool calling loop*):
`grep` ➡️ aguarda LLM ➡️ `read_file` ➡️ aguarda LLM ➡️ `replace_file` ➡️ ...

Esse padrão tem três problemas críticos:
1. **Queima massiva de contexto:** Milhares de linhas de código intermediário poluem a janela de contexto.
2. **Alta latência:** Cada turno de rede com a nuvem custa de 2 a 5 segundos (10 turnos = ~30s de espera).
3. **Falta de atomicidade:** Se a IA falhar na 4ª edição de um lote de 5 arquivos, o disco fica corrompido em estado parcial.

**O Codemode inverte essa lógica:** Em vez de trazer gigabytes de código para a LLM, a LLM escreve um script JavaScript assíncrono e compacto que executa **localmente, dentro do sandbox WebAssembly na máquina do usuário**, filtrando e transformando dados na velocidade da memória.

---

## 🔬 Metodologia e Resultados de Benchmark

Para quantificar a vantagem do Codemode contra o modo tradicional de *tool calling*, desenvolvemos uma bateria de benchmark automatizada e estatisticamente controlada.

### Metodologia de Avaliação
- **Modelo de Latência Real Percebida pelo Usuário:**
  $$T_{\text{percebido}} = (N_{\text{turnos}} \times T_{\text{LLM\_roundtrip}}) + T_{\text{local}}$$
  Onde $T_{\text{LLM\_roundtrip}} = 2.200\text{ms}$ (média empírica de latência de rede HTTP/SSE + geração de tokens em modelos de ponta como Claude 3.5 Sonnet / GPT-4o / Gemini 1.5 Pro) e $T_{\text{local}}$ é a latência bruta de CPU no host.
- **Modelo de Estimativa de Tokens:** $\text{Tokens} = \lceil \text{Bytes do Payload} / 4 \rceil$ (canônico para código-fonte e estruturas JSON).
- **Rigor Estatístico:** Amostragem com $N=3$ repetições independentes com cálculo de Média ($\mu$) e Desvio Padrão ($\sigma$).
- **Ambiente de Teste:** Windows 11 x64, 16 CPUs, Node.js v24.19.0, QuickJS WASI 3.6.2, Ripwire v0.6.5.

### Tabela Científica Consolidada

| Cenário Avaliado | Métrica | Modo Tradicional (Normal) | Codemode (WASM + Ripwire) | Ganho / Eficiência Real |
| :--- | :--- | :---: | :---: | :---: |
| **1. Mapeamento Arquitetural**<br>(Explorar topologia de 10 arquivos) | Turnos LLM<br>Tokens de Contexto<br>Latência Host (CPU)<br>Tempo Real Usuário<br>Atomicidade | 11 chamadas<br>~14.527 tokens<br>13.7 ± 3.1 ms<br>~24.2 s<br>NÃO | **1 chamada**<br>**~274 tokens**<br>453.9 ± 46.2 ms<br>**~2.7 s**<br>NÃO | **-90,9% turnos**<br>**98,1% de economia**<br>Motor local QuickJS<br>**~9.1x mais rápido**<br>Rápido |
| **2. Blast Radius & Callers**<br>(Chamadores e alcance de `resolvePath`) | Turnos LLM<br>Tokens de Contexto<br>Latência Host (CPU)<br>Tempo Real Usuário<br>Atomicidade | 6 chamadas<br>~15.857 tokens<br>31.8 ± 1.1 ms<br>~13.2 s<br>NÃO | **1 chamada**<br>**~450 tokens**<br>609.6 ± 39.7 ms<br>**~2.8 s**<br>NÃO | **-83,3% turnos**<br>**97,2% de economia**<br>PageRank + Ego-graph<br>**~4.7x mais rápido**<br>Rápido |
| **3. Refatoração Multi-Arquivo**<br>(Modificar 5 arquivos em lote com staging) | Turnos LLM<br>Tokens de Contexto<br>Latência Host (CPU)<br>Tempo Real Usuário<br>Atomicidade | 10 chamadas<br>~134 tokens<br>5.5 ± 0.3 ms<br>~22.0 s<br>**NÃO** (risco parcial) | **2 chamadas** (run + apply)<br>**~268 tokens** (com diff)<br>126.9 ± 7.4 ms<br>**~4.5 s**<br>**SIM (Rollback Atômico)** | **-80,0% turnos**<br>Diff unificado para revisão<br>Transacional em memória<br>**~4.9x mais rápido**<br>**Integridade 100%** |
| **4. Task Lens Context Gathering**<br>(Montagem direcionada para "security policy") | Turnos LLM<br>Tokens de Contexto<br>Latência Host (CPU)<br>Tempo Real Usuário<br>Atomicidade | 4 chamadas<br>~6.229 tokens<br>94.6 ± 6.0 ms<br>~8.9 s<br>NÃO | **1 chamada**<br>**~31 tokens**<br>1267.2 ± 104.2 ms<br>**~3.5 s**<br>NÃO | **-75,0% turnos**<br>**99,5% de economia**<br>Análise semântica Ripwire<br>**~2.6x mais rápido**<br>Foco absoluto |

> **Teste de Estresse de Memória (Cenário 5):** 10 ciclos consecutivos de inicialização, execução intensiva e desmontagem do QuickJS WASM completados em 1.073ms (~107ms/ciclo), apresentando **zero vazamento de memória** (variação de RSS negativa de -29,04 MB via Garbage Collection ativo).
>
> 📖 Para a análise aprofundada de cada cenário, consulte o [Relatório Científico Completo (docs/BENCHMARK_CODEMODE.md)](docs/BENCHMARK_CODEMODE.md).
>
> 🔄 Para reproduzir estes números em sua máquina: `npm run benchmark`.

## ⚡ Principais Capacidades

### 1. Sandbox Isolado em WebAssembly (QuickJS WASI)
- Execução segura e estéril: sem acesso arbitrário a rede (`fetch`), processos (`child_process`) ou eval não-controlado.
- Limite estrito de tempo de execução (watchdog de 30s) e teto de memória (128 MB).
- Comunicação bidirecional assíncrona por protocolo binário IPC em memória.

### 2. Navegação Semântica com Ripwire
- Grafo de código construído dinamicamente com **Personalized PageRank**.
- Métodos nativos:
  - `tools["ripwire.map"]`: Topologia arquitetural e arquivos mais influentes do repositório.
  - `tools["ripwire.callers"]`: Identifica chamadores diretos de qualquer função ou interface.
  - `tools["ripwire.impact"]`: Calcula o *blast radius* transitivo antes de você alterar uma linha.
  - `tools["ripwire.uses"]`: Usos, leituras, instanciações e implementações.
  - `tools["ripwire.for"]`: Task Lens focada para o objetivo de desenvolvimento.

### 3. Filesystem com Staging e Rollback Atômico
- **Staging-first:** Nenhuma alteração é gravada diretamente no disco durante a execução do script.
- Geração de **unified diff** para inspeção antes do commit.
- Validação otimista de concorrência com o disco real antes da aplicação.
- Rollback automático: se qualquer arquivo falhar na gravação em lote, todos os arquivos restauram seu estado anterior intacto.

### 4. Camada de Segurança para Windows NTFS
- Proteção contra caminhos UNC (`\\server\share`) e namespaces de dispositivo Win32 (`\\?\`).
- Bloqueio de Alternate Data Streams (ADS) e nomes reservados do MS-DOS (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`).
- Imunidade a condições de corrida TOCTOU no NTFS usando identidade de arquivo de 64 bits (`fs.stat(..., { bigint: true })`).
- Proteção contra ReDoS catastrófico isolando regexes em **Worker Threads dedicadas com watchdog de 600ms**.

---

## 🚀 Instalação Rápida

Para instalar e habilitar o Codemode em sua máquina:

```bash
# 1. Clone o repositório
git clone https://github.com/mjabbur/antigravity-codemode.git
cd antigravity-codemode

# 2. Instale as dependências e compile
npm run install:server
npm run build

# 3. Valide o ambiente executando os testes
npm test
```

📖 **Consulte o guia completo com passo a passo para configuração Global ou por Projeto em:**  
👉 **[Guia Detalhado de Instalação (INSTALL.md)](INSTALL.md)**

---

## 💡 Exemplos de Uso

Uma vez instalado, você pode acionar o comando `/codemode` no Google Antigravity ou o agente utilizará as ferramentas MCP automaticamente quando julgar mais econômico.

### Exemplo 1: Orientação e Chamadores no Repositório
```javascript
// Localiza os arquivos centrais e descobre quem consome o método `resolvePath`
const map = await tools["ripwire.map"]({ topK: 10 });
const callers = await tools["ripwire.callers"]({ symbol: "resolvePath" });

return {
  totalFiles: map.files,
  topRanked: map.r.map(f => f.p),
  callersCount: callers.count,
  callersList: callers.callers
};
```

### Exemplo 2: Refatoração Multi-Arquivo com Staging
```javascript
// Substitui uma versão em todos os package.json de forma segura
const files = await tools.glob({ pattern: "**/package.json" });

for (const file of files) {
  const content = await tools.readFile({ path: file });
  if (content.includes('"version": "1.0.0"')) {
    await tools.editFile({
      path: file,
      oldText: '"version": "1.0.0"',
      newText: '"version": "1.1.0"'
    });
  }
}

// O resultado conterá o diff unificado em staging
return { stagedCount: files.length };
```

Após inspecionar o diff retornado, basta aprovar a aplicação chamando `codemode_apply` (ou `codemode_discard` para cancelar).

---

## 📁 Estrutura do Repositório

```
antigravity-codemode/
├── .agents/
│   ├── mcp_config.json                   # Configuração de exemplo do servidor MCP
│   ├── plugins/codemode/
│   │   ├── plugin.json                   # Manifesto do plugin
│   │   └── server/                       # Motor Node.js / TypeScript
│   │       ├── specs/                    # Especificações formais SDD (Fases 1 a 4)
│   │       ├── src/
│   │       │   ├── sandbox/              # QuickJS WASM, Host, Worker e Protocolo IPC
│   │       │   ├── security/             # PathPolicy com contenção Windows NTFS
│   │       │   ├── tools/                # fs-read, fs-write (staging), ripwire, regex
│   │       │   └── mcp/                  # Servidor MCP stdio (codemode_run, apply, discard)
│   │       ├── test/                     # 48 testes unitários/invariantes no Vitest
│   │       └── benchmarks/               # Script do benchmark comparativo
│   ├── rules/
│   │   └── codemode-policy.md            # Regra de priorização econômica para o agente
│   └── skills/
│       └── codemode/SKILL.md             # Instruções e comandos do Codemode (/codemode)
├── bin/
│   └── ripwire-0.6.5-windows-x64/        # Binário nativo do Ripwire v0.6.5
├── docs/
│   ├── GUIA_DE_USO_CODEMODE.md           # Guia operacional detalhado e receitas de código
│   ├── BENCHMARK_CODEMODE.md             # Relatório empírico com métricas de tokens e latência
│   ├── PLANO_CODEMODE.md                 # Arquitetura e plano diretor
│   └── TIME_E_METODOLOGIA.md             # Governança e metodologia Spec-Driven Development
├── INSTALL.md                            # Guia passo a passo de instalação
├── HANDOFF.md                            # Relatório de passagem de bastão operacional
├── MEMORY.md                             # Memória técnica e aprendizados de engenharia
└── package.json                          # Scripts de conveniência na raiz (build, test, benchmark)
```

---

## 🛠️ Comandos de Desenvolvimento

Na raiz do repositório:

- **Instalar dependências:** `npm run install:server`
- **Compilar TypeScript:** `npm run build`
- **Executar testes:** `npm test`
- **Rodar benchmark:** `npm run benchmark`

---

## 📚 Documentação Adicional

- [Guia de Instalação (INSTALL.md)](INSTALL.md)
- [Guia de Uso e Receitas (docs/GUIA_DE_USO_CODEMODE.md)](docs/GUIA_DE_USO_CODEMODE.md)
- [Relatório de Benchmark (docs/BENCHMARK_CODEMODE.md)](docs/BENCHMARK_CODEMODE.md)
- [Passagem de Bastão Operacional (HANDOFF.md)](HANDOFF.md)
- [Memória de Sessão e Decisões de Engenharia (MEMORY.md)](MEMORY.md)

---

## 📄 Licença

Distribuído sob a licença [MIT](LICENSE).
