# HANDOFF: Plugin Codemode para Google Antigravity

> **Data:** 02/10/2026  
> **Status do Projeto:** 100% Concluído, Documentado e Publicado  
> **Metodologia:** Spec-Driven Development (SDD)  
> **Repositório:** `https://github.com/mjabbur/antigravity-codemode` (branch `main`)

---

## 1. Visão Geral da Entrega

O projeto consistiu em projetar, especificar, implementar, testar, auditar e publicar um **Plugin Codemode de Alta Performance para o Google Antigravity**, inspirado na arquitetura do Pi 1.0 (`@earendil-works/pi-codemode`) e potencializado com a engine de inteligência de código e grafos de chamada **Ripwire** (`redhat-et/ripwire`).

O objetivo é substituir o padrão verboso e lento de múltiplos turnos de LLM (*tool calling* sequencial na nuvem) por uma execução local, assíncrona e em lote de scripts JavaScript em um sandbox seguro em WebAssembly (**QuickJS**), garantindo tempos de resposta em milissegundos e economia de até **99,5% em tokens de contexto**, com aceleração média de **5.3x na latência real percebida pelo desenvolvedor**.

---

## 2. Status das Fases (100% Concluídas & Homologadas)

| Fase | Escopo | Especificação | Implementação | Testes | Parecer Auditoria (Claude Code) |
| :--- | :--- | :--- | :--- | :---: | :---: |
| **Fase 1** | Sandbox QuickJS WASM & IPC | `specs/01-sandbox.spec.md` | `src/sandbox/` | 12 testes | **Homologado** |
| **Fase 2** | Segurança Windows & Filesystem Staging | `specs/02-security-fs.spec.md` | `src/security/`, `src/tools/` | 22 testes | **Homologado** |
| **Fase 3** | Integração Ripwire (Mapeamento & Blast Radius) | `specs/03-ripwire.spec.md` | `src/tools/ripwire.ts` | 8 testes | **Homologado** |
| **Fase 4** | Servidor MCP Stdio (`codemode_run`, `apply`, `discard`) | `specs/04-mcp.spec.md` | `src/mcp/server.ts` | 6 testes | **Homologado** |
| **Fase 5** | Integração Antigravity (Skills, Rules & MCP Config) | N/A | `.agents/skills/`, `.agents/rules/`, `mcp_config.json` | E2E | **Homologado** |

---

## 3. Mapa de Arquitetura e Componentes

```
c:\Dev\Joker\
├── .agents/
│   ├── mcp_config.json                   # Exemplo de registro do servidor MCP para o Antigravity
│   ├── plugins/codemode/
│   │   ├── plugin.json                   # Manifesto do plugin
│   │   └── server/                       # Motor Node.js / TypeScript
│   │       ├── specs/                    # Especificações formais SDD (Fases 1 a 4)
│   │       ├── src/
│   │       │   ├── sandbox/              # Motor QuickJS WASM, Host, Worker e Protocolo IPC
│   │       │   ├── security/             # PathPolicy com contenção estrita Windows NTFS
│   │       │   ├── tools/                # fs-read, fs-write (staging), regex-matcher, ripwire
│   │       │   └── mcp/                  # Servidor MCP stdio (codemode_run, apply, discard)
│   │       ├── test/                     # Suíte com 48 testes unitários/invariantes no Vitest
│   │       └── benchmarks/               # Bateria de benchmark automatizada e estatística (N=3)
│   ├── rules/
│   │   └── codemode-policy.md            # Diretriz de priorização do Codemode no Antigravity
│   └── skills/
│       └── codemode/SKILL.md             # Skill documentando quando e como usar o codemode (/codemode)
├── bin/
│   └── ripwire-0.6.5-windows-x64/        # Binário nativo do Ripwire v0.6.5 para Windows x64
├── docs/
│   ├── USAGE_GUIDE.md                    # Manual operacional completo em inglês e receitas
│   ├── BENCHMARK_CODEMODE.md             # Relatório científico de benchmark com metodologia e estatística
│   ├── GUIA_DE_USO_CODEMODE.md           # Versão em português do guia de uso
│   ├── PLANO_CODEMODE.md                 # Plano diretor e arquitetura completa
│   └── TIME_E_METODOLOGIA.md             # Governança SDD e papéis do time
├── INSTALL.md                            # Guia completo de instalação e configuração global/local (em inglês)
├── README.md                             # Documento principal do repositório em inglês com badges e tabelas
├── LICENSE                               # Licença de código aberto MIT
├── package.json                          # Scripts de conveniência na raiz (build, test, benchmark)
├── HANDOFF.md                            # Este documento de passagem de bastão operacional
├── MEMORY.md                             # Memória técnica e aprendizados de engenharia
└── .gitignore                            # Configuração de exclusões de VCS
```

---

## 4. Decisões Técnicas Críticas & Blindagens de Segurança

1. **Staging-first Inviolável:**
   - O método `applyStaged` **não é exposto dentro do sandbox QuickJS**.
   - Scripts podem apenas ler e colocar alterações em staging (`writeFile`, `editFile`).
   - A gravação física no disco só ocorre quando o cliente invoca a ferramenta MCP separada `codemode_apply`, após a inspeção do diff retornado.

2. **Segurança de Caminhos Confinada para Windows (NTFS):**
   - Bloqueio de caminhos UNC (`\\`, `//`), namespaces Win32 (`\\?\`), Alternate Data Streams (`:stream`), 8.3 short names e nomes reservados do MS-DOS (`CON`, `PRN`, `AUX`, `NUL`, inclusive com superscripts `COM¹` e extensões compostas).
   - Bloqueio estrito de leitura/escrita em `.git`, `.aws`, `.ssh` e arquivos de credenciais (`.env*`, `.pem`, `.key`, `.jks`).
   - Eliminação de **TOCTOU** comparando `dev` e `ino` em 64 bits (`bigint: true`) entre o `fs.stat` inicial e o `handle.stat` após a abertura do arquivo.

3. **Mitigação Definitiva de ReDoS:**
   - O `grep` não depende de heurísticas frágeis de regex.
   - Padrões com `isRegex: true` são despachados para **Worker Threads dedicadas** com timeout rígido de 600ms e terminação imediata via `worker.terminate()`.
   - Backtracking exponencial é abortado sem travar o Event Loop do host. Padrões legítimos como `(a|b)+`, `(foo|bar)*` e quantificadores preguiçosos rodam com zero falsos positivos.

4. **Rollback Atômico na Aplicação:**
   - `applyStaged` verifica divergências de concorrência com o disco (otimista), gera arquivos `.tmp`, renomeia e mantém backups em memória/disco. Em caso de falha de I/O em qualquer arquivo do lote, todos os arquivos anteriores são restaurados ao estado original intacto.

---

## 5. Como Operar, Testar e Executar

A partir da raiz do repositório (`c:\Dev\Joker`):

### 5.1. Executar os Testes Automatizados
```bash
npm test
```
*Resultado esperado: 4 arquivos de teste, 48 testes passando no Vitest (100% de sucesso em ~2.5s).*

### 5.2. Compilar o Projeto (TypeScript)
```bash
npm run build
```
*Resultado esperado: compilação limpa sem erros via `tsc` gerando artefatos em `dist/`.*

### 5.3. Rodar a Bateria Científica de Benchmark
```bash
npm run benchmark
```
*Resultado esperado: execução dos 5 cenários com amostragem $N=3$, exibindo média, desvio padrão, redução de tokens de até 99,5%, aceleração real de até 9.1x e teste de estresse de memória com zero leaks.*

### 5.4. Inicialização do Servidor MCP (Standalone via stdio)
```bash
node .agents/plugins/codemode/server/dist/mcp/server.js
```

---

## 6. Histórico de Commits e Sincronização GitHub

O repositório está 100% versionado e sincronizado com o GitHub remoto:
- **Repositório:** `https://github.com/mjabbur/antigravity-codemode`
- **Branch:** `main` (em sincronia exata com `origin/main`)
- **Linha do Tempo de Commits:**
  - `7e23bb4`: Implementação completa das Fases 1 a 5 (QuickJS WASM, Segurança Windows, Ripwire, MCP).
  - `8f3d229`: Documentação de uso, suíte de benchmarks e relatórios.
  - `cc2ab5b`: Documentos de governança, memória de sessão e handoff.
  - `c1b52aa`: Registro e ativação global do codemode no Google Antigravity (`~/.gemini/config/`).
  - `80512d9`: Adição de `README.md`, `INSTALL.md`, `LICENSE` e `package.json` na raiz.
  - `fc63447`: Metodologia científica e resultados consolidados de benchmark no README.
  - `634fdbc`: Tradução completa para o inglês dos documentos públicos (`README.md`, `INSTALL.md`, `BENCHMARK_CODEMODE.md`, `USAGE_GUIDE.md`).

---

## 7. Instalação e Ativação Global no Antigravity

Para que o **Codemode** esteja disponível de forma transparente em **qualquer projeto ou workspace** aberto no Google Antigravity nesta máquina (sem necessidade de reconfiguração manual por projeto), os seguintes componentes globais foram registrados em `~/.gemini/config/`:

1. **Configuração Global MCP (`C:\Users\mjabb\.gemini\config\mcp_config.json`):**
   - Registra o servidor MCP `codemode` apontando para o binário compilado `dist/mcp/server.js` e com o binário nativo do `ripwire.exe` configurado.
2. **Skill Global (`C:\Users\mjabb\.gemini\config\skills\codemode\SKILL.md`):**
   - Torna o comando `/codemode` e a capacidade de invocação do Codemode visíveis para o agente em qualquer diretório ou workspace aberto.
3. **Pacote de Plugin Global (`C:\Users\mjabb\.gemini\config\plugins\codemode/`):**
   - Contém `plugin.json`, `mcp_config.json` e skills empacotadas para permitir carregamento unificado pelo motor de extensões do Antigravity.

---

## 8. Conclusão da Passagem de Bastão

O produto está pronto para consumo público e uso diário no Google Antigravity:
- Repositório público com documentação completa em inglês para desenvolvedores globais.
- 100% dos testes e verificações estáticas passando.
- Desempenho e economia comprovados empiricamente.
- Ativação global concluída e homologada no ambiente local do usuário.
