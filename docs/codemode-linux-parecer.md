# Parecer — portabilidade Linux do plugin codemode

> Claude Code, 2026-10-03. Revisão independente da branch `fix/codemode-linux-portability`
> (commits `0ad30ef`, `cffe30d`, `e65e3c2`, `b22fa8c`, `1cc35bf`, sobre `cecbd3b`).
> Não editei `src/`, `dist/` nem testes. Só li, rodei verificações e escrevi este arquivo.

## Decisão: [APROVADO] (rodada 2; a rodada 1 foi devolvida ao agy)

## 1. Método

Linux real: WSL2 Ubuntu-26.04, Node 24.21.0 (nvm, instalado só para esta validação), checkout limpo de `HEAD`
extraído com `git archive`, `npm ci`, `npm run build`, `npm test`. Ripwire Linux: release oficial 0.6.5 linux-x64,
SHA-256 conferido. Windows: `npm run build` e `npm test` no Node do Windows.

## 2. Achados da avaliação estática do agy, verificados antes de implementar

Provas do agy rodadas em Linux antes da correção:
- **Confirmados:** A1 (contenção quebrada por `toLowerCase`, falha de segurança), A2 (staging junta `A.txt` e `a.txt`),
  B2 a B5 (regras Win32 bloqueando nomes válidos), D1 (`ENOTDIR`), D2 (perda do bit `+x`), E1 (ripwire fixo no `.exe`
  derruba o MCP), E2 (M07 só Windows).
- **Refutados e deliberadamente não alterados:** B1 (`c:test.txt` mantém o nome; o `slice(2)` só afeta a checagem de ADS)
  e C1 (workspace via symlink funciona, pois a raiz já passa por `realpath`).

## 3. Resultado final

| Cenário | Total | Aprovados | Falhos | Pulados |
|---|---|---|---|---|
| Linux, sem `RIPWIRE_PATH` (o `.exe` do Windows existe em `bin/`) | 56 | 47 | 0 | 9 (ripwire) |
| Linux, com ripwire Linux via `RIPWIRE_PATH` | 56 | 56 | 0 | 0 |
| Windows | 56 | 56 | 0 | 0 |

- O servidor MCP sobe direto em Linux sem ripwire: `node dist/mcp/server.js` responde `initialize` e `tools/list` e sai com 0.
  O guarda do commit `cecbd3b` também funciona em Linux.
- Rodada 1 (`b22fa8c`): 52/56 com ripwire, e 46/56 sem `RIPWIRE_PATH`. Eu devolvi dois problemas:
  1. Os testes usavam o `ripwire.exe` de `bin/` como `RIPWIRE_PATH` em qualquer SO, e falhavam com `spawn ...ripwire.exe`.
  2. S03, S04, S05 e S17 afirmavam comportamento Windows com os defaults.
- Rodada 2 (`1cc35bf`): fallback do `.exe` só em `win32`, via `test/helpers/ripwire.ts`; M02 com `skipIf`; S03, S04, S05 e S17
  agora passam `{ isWindows: true, caseInsensitive: true }` com as mesmas asserções. Nenhum teste foi enfraquecido ou removido.

## 4. Revisão do código

- **Contenção (A1):** em FS sensível a caixa, o prefixo é comparado exato (`canonical === root` ou
  `startsWith(root + sep)`). Com `caseInsensitive: true` (default só em `win32`) o comportamento anterior é mantido.
  UNC, `\\?\`, NUL, `.git/.aws/.ssh` e arquivos secretos continuam bloqueados em qualquer SO.
- **Staging (A2), `ENOTDIR` (D1), modo POSIX (D2):** `canonicalKey` respeita a flag, `ENOTDIR` é tratado como `ENOENT`
  nos três pontos de leitura, e o `chmod` do arquivo temporário usa o modo lido antes do `rename`.
- **Ripwire (E1):** resolução tardia (`RIPWIRE_PATH`, depois `ripwire` no `PATH`), sem caminho Windows fixo; sem binário,
  só as ferramentas `ripwire.*` falham, com mensagem clara.

## 5. Observações (não bloqueiam)

1. **macOS:** os defaults seguem `process.platform === "win32"`, então o macOS fica como case-sensitive, embora o APFS padrão
   seja insensível. Não foi testado. Se macOS entrar no escopo, adotar `darwin` no default de `caseInsensitive`.
2. **Mudança de comportamento no Windows:** o fallback fixo `c:\Dev\Joker\bin\...\ripwire.exe` foi removido. Funciona porque
   `mcp_config.json` e `plugin.json` definem `RIPWIRE_PATH`. Instalações sem essa variável, e sem `ripwire` no `PATH`,
   perdem as ferramentas ripwire até configurar.
3. **`chmod` ignora erros em silêncio** (`catch {}`): em FS que não suporta modo, a escrita segue sem preservar permissões.
   Aceitável, mas vale um comentário.
4. **Raiz `/` como workspace:** `workspaceRoot + path.sep` vira `//`, e a checagem exata nunca casa. É caso de borda e não
   recomendado de qualquer forma.
5. **`dist/` é ignorado pelo git:** em cada instalação é preciso rodar `npm run build`. Em Linux, também `npm ci`.
   O `package.json` e o lockfile não têm dependências nativas Windows; o `npm ci` no WSL funcionou.
6. **INSTALL.md:** ainda diz "48 testes" e que o binário Windows está incluído; atualizar para 56 testes e para o passo de
   Linux (baixar o release linux-x64 e definir `RIPWIRE_PATH`).
7. **`pi/` e `.agents/rules/codemode-policy.md`** continuam fora dos commits, e nenhum doc de handoff foi commitado.

## 6. Perguntas em aberto (decisão do dono)

- Registrar o ripwire Linux dentro do repositório (`bin/`) ou manter o passo manual do INSTALL.md?
- Incluir macOS no escopo suportado (observação 1)?
- Merge das duas branches (`fix/codemode-mcp-windows-guard` e `fix/codemode-linux-portability`) é do dono; a segunda contém a primeira.
