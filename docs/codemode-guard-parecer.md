# Parecer — correção do guarda de ponto de entrada do codemode MCP

> Claude Code, 2026-10-03. Revisão independente do commit `cecbd3b` (branch `fix/codemode-mcp-windows-guard`).
> Não editei `src/`, `dist/` nem testes; apenas li, rodei verificações e escrevi este arquivo.

## Decisão: [APROVADO]

## 1. Reprodução independente

Antes (no estado inicial, cwd `C:\Dev\Horus`):
- `node c:/Dev/Joker/.../dist/mcp/server.js` com `initialize` por stdin: exit 0, nenhuma saída.
- Import + `runServer()`: `initialize` respondeu normalmente.
- O guarda com a construção defeituosa estava em `src/mcp/server.ts:198` e em `dist/mcp/server.js:142`.

Depois (`dist` novo, que contém `isMainModule`): `initialize`, `notifications/initialized` e `tools/list`
pelo `server.js` direto, com três grafias de caminho. Todas deram exit 0 e 2 respostas, com as 3 ferramentas
(`codemode_run`, `codemode_apply`, `codemode_discard`):
- `c:/Dev/Joker/...` (barras normais, unidade minúscula)
- `C:\Dev\Joker\...` (barras invertidas, unidade maiúscula)
- `c:\dev\joker\...` (tudo minúsculo)

## 2. Testes

`npm test` (rodado por mim): 4 arquivos, **49 testes, 49 aprovados, 0 falhos**. Bate com o relatório do agy.
Não rodei `npm run build`; confirmei que o `dist` atual contém `isMainModule` (linhas 142 e 164).

## 3. Revisão do diff

- Escopo correto: só `src/mcp/server.ts` e `test/mcp.test.ts`. `dist/` é ignorado pelo git (`.gitignore:3`).
  `codemode-policy.md`, `pi/` e os docs de handoff não entraram no commit.
- Correção correta: `pathToFileURL(argv1).href === metaUrl`, com `argv[1]` indefinido ou vazio tratado como `false`.
- O teste M07 cobre unidade maiúscula e minúscula (no argv e na URL), `\` e `/`, espaços, `undefined`, string vazia
  e script diferente. Nenhum teste existente foi enfraquecido.
- Outros usos de `import.meta.url` (`sandbox/host.ts`, `sandbox/wasm.ts`, `tools/regex-matcher.ts`) só resolvem
  recursos relativos, sem comparação com `argv[1]`. Concordo com o relatório.

## 4. Observações (não bloqueiam)

1. O comentário diz "letra da unidade", mas o fallback compara o caminho inteiro sem diferenciar maiúsculas de
   minúsculas. Isso é inofensivo no Windows (sistema de arquivos insensível a maiúsculas), mas o comentário está impreciso.
2. O fallback também roda fora do Windows quando `argv1` parece caminho `X:\`. O M07 depende disso e ficaria frágil
   em Linux ou macOS. Hoje o plugin só roda no Windows, então não é problema prático.
3. Sobra uma linha em branco no fim de `server.ts` e de `mcp.test.ts`.
4. A seção 3 do relatório afirma como o Antigravity inicia o servidor ("Language Server ... dispara o handshake").
   Isso é **inferência**: foi observado que `mcp_config.json` e `plugin.json` apontam para o `server.js` e que o
   `codemode_run` não estava na sessão do agy, mas o mecanismo interno do Antigravity não foi verificado.
5. Como `dist/` é ignorado pelo git, a correção só vale onde se rodar `npm run build`. A cópia do Horus precisa
   do `dist` novo, não só do `src`.

## 5. Perguntas em aberto (decisão do dono)

Concordo com as duas do relatório: reiniciar a sessão do Antigravity para ativar as ferramentas, e registrar ou
não o servidor na configuração global (`~/.gemini/config/mcp_config.json`, hoje com `mcpServers: {}`).
Sem merge: o merge é do dono.
