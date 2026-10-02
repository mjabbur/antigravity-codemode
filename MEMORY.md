# MEMORY: Memória da Sessão e Decisões de Engenharia

> **Projeto:** Plugin Codemode para Google Antigravity  
> **Data:** 02/10/2026  
> **Metodologia:** Spec-Driven Development (SDD)

---

## 1. Contexto e Filosofia da Colaboração

O projeto foi conduzido com uma divisão estrita de responsabilidades entre múltiplos agentes e ferramentas para maximizar a qualidade técnica e minimizar custos:

1. **Product Owner / Decisor Final (Usuário):**
   - Validou a visão do produto: trazer as capacidades do Pi 1.0 e do Ripwire para o Google Antigravity.
   - Aprovou a metodologia SDD e a inclusão do Claude Code como revisor de código independente.
   - Solicitou benchmark comparativo, documento de uso e handoff.

2. **Engenheiro Líder & Arquiteto (Antigravity):**
   - Redigiu as 4 especificações formais com contratos de tipos e invariantes de teste (`specs/*.spec.md`).
   - Orquestrou a execução dos subagentes, desenhou a camada de segurança para Windows e a arquitetura do servidor MCP.
   - Coordenou a resolução das observações e apontamentos da auditoria do Claude Code.

3. **Codificador Econômico (Subagentes `flash_lite`):**
   - Implementaram os arquivos de código estritamente contra as especificações (Scaffold do Sandbox, PathPolicy, Filesystem Read/Write com Staging).

4. **Verificador Determinístico Local ($0 LLM Cost):**
   - `vitest`: 48 testes unitários/invariantes executados localmente garantindo ausência de regressões a cada iteração.
   - `tsc` (TypeScript Compiler): Validação de tipos rigorosa com `moduleResolution: NodeNext`.

5. **Revisor de Código & Auditor de Segurança (Claude Code via CLI):**
   - Submetido via subprocesso em background (`claude --dangerously-skip-permissions -p -`).
   - Conduziu auditorias de segurança estáticas e empíricas independentes, levantando vulnerabilidades não-óbvias (TOCTOU no NTFS, ReDoS exponencial, `$1` backreferences em `replace`, etc.) e emitindo a homologação formal de cada fase.

---

## 2. Aprendizados Técnicos e Armadilhas Superadas

Durante o desenvolvimento deste projeto, foram identificadas e solucionadas diversas armadilhas críticas em ambientes Node.js + Windows:

### 2.1. Traps de Caminho no Windows NTFS
- **Normalização silenciosa do Win32:** O Windows remove automaticamente pontos e espaços no final de nomes de arquivos (`file.txt.` vira `file.txt`, `.env ` vira `.env`). Na `PathPolicy`, adicionamos rejeição explícita para qualquer segmento com trailing dots ou espaços.
- **Nomes Reservados MS-DOS com Extensões Compostas:** Nomes como `CON`, `PRN`, `AUX`, `NUL` são reservados independentemente da extensão (ex: `con.tar.gz` ainda ativa o driver de console). A validação foi ajustada para verificar o prefixo antes do primeiro ponto (`segment.split(".")[0]`).
- **Nomes Reservados com Superscripts:** O Windows reserva variantes de portas seriais/paralelas com sobrescritos (`COM¹`, `COM²`, `COM³`, `LPT¹`, `LPT²`, `LPT³`), que foram incorporadas ao `DOS_RESERVED`.

### 2.2. TOCTOU e Identidade de Arquivo NTFS em 64 bits
- Em verificações de symlink/junction, validar apenas o `realpath` antes do `open` deixa uma janela de corrida (TOCTOU).
- A solução definitiva foi verificar a identidade do handle aberto comparando `dev` e `ino` com o `fs.stat` prévio.
- **Armadilha do BigInt:** Em NTFS, o File ID (`ino`) é um inteiro de 64 bits que frequentemente ultrapassa $2^{53}-1$. O `stat` padrão do Node.js converte para `Number` com ponto flutuante, perdendo bits de precisão e gerando falsos positivos. Foi obrigatório o uso de `{ bigint: true }` em todas as chamadas de `stat` e `handle.stat`.

### 2.3. ReDoS e Backtracking Exponencial
- Listas de bloqueio estáticas por regex para detectar ReDoS são fundamentalmente incompletas (deixam passar padrões exponenciais com alternâncias como `(a|aa)+$`, `(a|a)*$` e `(?:(a+))+$`).
- A solução arquitetural robusta foi isolar a execução de expressões regulares em uma **Worker Thread dedicada** com timeout rígido de 600ms e `terminate()`. Se um script do usuário submeter uma regex patológica, apenas a thread isolada é morta, mantendo o Event Loop do host livre e sem falsos positivos em regexes complexas legítimas.

### 2.4. Armadilha do `String.prototype.replace`
- No JavaScript, `str.replace(oldText, newText)` interpreta sequências especiais como `$1`, `$&`, `$$` e `$''` dentro de `newText`.
- Se um usuário editar um arquivo contendo um cifrão (ex: `preço: $100` ou código com jQuery/bash), o `replace` expandiria ou corromperia o texto.
- A solução no `editFile` foi utilizar `str.replace(oldText, () => newText)`, onde a função replacer trata o conteúdo como string puramente literal.

### 2.5. Resolução de Módulos Node 24 ESM e QuickJS WASM
- No Node 24 com `moduleResolution: NodeNext`, módulos TypeScript que referenciam outros arquivos locais precisam de extensões explícitas.
- Foi configurado o `tsconfig.json` com `allowImportingTsExtensions` e `rewriteRelativeImportExtensions`, permitindo imports `.ts` durante os testes no Vitest e reescrita para `.js` ao compilar para `dist/`.

---

## 3. Estado dos Artefatos de Documentação

- [`docs/PLANO_CODEMODE.md`](file:///c:/Dev/Joker/docs/PLANO_CODEMODE.md): Plano de implantação formal com metas e arquitetura.
- [`docs/TIME_E_METODOLOGIA.md`](file:///c:/Dev/Joker/docs/TIME_E_METODOLOGIA.md): Governança SDD do time.
- [`docs/GUIA_DE_USO_CODEMODE.md`](file:///c:/Dev/Joker/docs/GUIA_DE_USO_CODEMODE.md): Manual completo de uso e receitas para agentes/desenvolvedores.
- [`docs/BENCHMARK_CODEMODE.md`](file:///c:/Dev/Joker/docs/BENCHMARK_CODEMODE.md): Resultados empíricos comprovando ~98% de economia de tokens e ganho de ~9x em latência real.
- [`HANDOFF.md`](file:///c:/Dev/Joker/HANDOFF.md): Documento de passagem de bastão operacional.

---

## 4. Ativação Global no Antigravity

Para eliminar qualquer necessidade de ativação manual por parte do usuário em novos projetos, o Codemode foi registrado no diretório global do Antigravity (`~/.gemini/config/`):
- `mcp_config.json`: Registra o servidor MCP `codemode` para inicialização automática em qualquer sessão.
- `skills/codemode/SKILL.md`: Skill global disponível em qualquer workspace da máquina.
- `plugins/codemode/`: Pacote de plugin global com `plugin.json` e recursos correspondentes.

