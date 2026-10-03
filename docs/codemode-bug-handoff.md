# Handoff — bug de inicialização do servidor MCP do codemode (Windows)

> Escrito pelo Claude Code em 2026-10-03, a pedido do dono, para ser lido pelo Claude Code
> e pelo Antigravity (agy) abertos juntos no Herdr. Os dois resolvem em conjunto.
> **Separe fato observado de inferência.** Os fatos abaixo foram medidos nesta máquina.

## 1. Resumo

O servidor MCP do plugin `codemode` não inicia quando executado com `node ...\dist\mcp\server.js`
no Windows: o processo sai com código 0, sem erro e sem responder ao protocolo. A causa provável
é um guarda de "ponto de entrada" que compara URLs de forma incorreta no Windows.

## 2. Fatos observados

**Local do plugin:** `C:\Dev\Joker\.agents\plugins\codemode\server` (`src/` em TypeScript, `dist/` compilado).
Node v24.19.0. Dependências: `quickjs-wasi` 3.6.2, `@modelcontextprotocol/sdk`, `zod`.

**O guarda** (fim de `dist/mcp/server.js`; confirmar o equivalente em `src/mcp/server.ts`):

```js
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
    runServer().catch(...)
}
```

**Medição com um script de teste** (mesma construção, em um `.mjs`):

```
import.meta.url = file:///C:/Users/.../guard-test.mjs     (3 barras)
argv[1]         = C:\Users\...\guard-test.mjs
guard string    = file://C:/Users/.../guard-test.mjs       (2 barras)
iguais?         = false
```

**Reprodução no servidor real** (cwd em `C:\Dev\Horus`, mensagens JSON-RPC por stdin):
- `node c:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js`: sem nenhuma saída, exit 0.
- Importando o módulo e chamando `runServer()` direto
  (`node -e "import('file:///C:/.../dist/mcp/server.js').then(m=>m.runServer())"`):
  responde `initialize` e `tools/list` normalmente (`codemode_run` aparece).
- Um `codemode_run` com `tools["ripwire.map"]({topK:3})` sobre o Horus devolveu 393 arquivos e 3.933 símbolos.

**Configuração atual do Joker:** `C:\Dev\Joker\.agents\mcp_config.json` e `plugin.json` chamam
`node c:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js` com
`RIPWIRE_PATH=c:/Dev/Joker/bin/ripwire-0.6.5-windows-x64/ripwire.exe`.

**Arquivo de contorno no Horus:** `C:\Dev\Horus\.agent\codemode-cli.mjs` importa os módulos do Joker
diretamente (sandbox, path-policy, fs-read, fs-write, ripwire), sem passar por `server.js`.

## 3. O que já foi feito no Horus (não refazer, não alterar)

- Cópia do plugin em `C:\Dev\Horus\.agents\plugins\codemode` (inclui `node_modules` e o `ripwire.exe`).
- Lançador `C:\Dev\Horus\.agents\plugins\codemode\server\start.mjs`: importa o módulo, define
  `RIPWIRE_PATH` relativo e chama `runServer()`.
- `C:\Dev\Horus\.agents\mcp_config.json` reescrito para chamar o `start.mjs`. O original foi salvo no scratchpad da sessão do Claude Code.
- **Nenhuma alteração foi feita em `C:\Dev\Joker`.**

## 4. Inferências e o que não se sabe

- **Inferência:** o guarda nunca é verdadeiro no Windows; a correção é comparar com
  `pathToFileURL(process.argv[1]).href`.
- **Não sabido:** como o Antigravity inicia o servidor hoje. Se ele passasse pelo guarda, o MCP
  não funcionaria; o `codemode-cli.mjs` sugere que isso já foi notado. Verificar.
- **Não sabido:** se o `codemode_run` está ativo na sessão do agy, e por qual servidor.
- **Não sabido:** se o Antigravity aceita caminho relativo ao workspace no `mcp_config.json`.

## 5. Tarefa

**Trabalhem em `C:\Dev\Joker`.** Não alterem `C:\Dev\Horus`.

1. **Reproduzir e confirmar** (sem alterar nada), no agy: o `server.js` direto, o import com `runServer()`, e como o Antigravity de fato inicia o servidor. Informar se o `codemode_run` está disponível e qual processo o serve.
2. **Se confirmado, corrigir em `src/`** (nunca editar `dist/` à mão): trocar a comparação por `pathToFileURL(process.argv[1]).href === import.meta.url`, tratando `argv[1]` indefinido. Adicionar teste que cubra caminho Windows (unidade em maiúscula/minúscula, `\`, espaços). Rodar `npm run build` e `npm test`; registrar total, aprovados e falhos. Repetir a reprodução com o `dist` novo e mostrar `initialize` e `tools/list` respondendo.
3. **Efeitos colaterais:** procurar outros usos de `import.meta.url` e `process.argv[1]` com a mesma construção; confirmar que `mcp_config.json` e `plugin.json` seguem válidos.

## 6. Divisão de papéis (os dois no Herdr)

- **agy (Antigravity):** implementa a correção no Joker, na própria branch, e escreve o relatório.
- **Claude Code:** reproduz de forma independente, revisa o diff e o teste, e assina o parecer.
  Não edita `src/`, `dist/` nem testes; só lê, roda comandos de verificação e escreve o parecer.
- **Comunicação:** use o Herdr (`herdr agent list`, `herdr agent prompt`, `herdr agent wait`,
  `herdr agent read`), mas **a conclusão é por arquivo, não por tela**: o agy só declara pronto
  quando `docs/codemode-guard-relatorio.md` existir; o Claude Code só conclui quando
  `docs/codemode-guard-parecer.md` existir. Quem espera confere o arquivo uma vez ao final.
- Não digitem em painéis que não sejam o do outro agente; não operem a sessão do dono.

## 7. Regras

- Branch própria em `C:\Dev\Joker`; um commit com a correção; **sem merge** (o merge é do dono).
- Não toquem em `.agents/rules/codemode-policy.md` (modificado, não commitado) nem em `pi/` (não rastreado), e não os incluam no commit. Este arquivo (`docs/codemode-bug-handoff.md`) também não entra no commit.
- Se um teste existente falhar, não o enfraqueçam nem o desativem: registrem e perguntem ao dono.
- Se encontrarem algo que exija decisão do dono (por exemplo, o Antigravity iniciar o servidor por outro caminho), registrem como pergunta em vez de assumir.
- Não copiem o plugin corrigido para o Horus. Depois da revisão, o Claude Code (sessão do Horus) atualiza a cópia local e remove o `start.mjs` se não for mais necessário.

## 8. Entrega

- `docs/codemode-guard-relatorio.md` (agy): resultado da reprodução antes e depois, causa confirmada ou divergência, como o Antigravity inicia o servidor, diff resumido e commit, build e testes, perguntas em aberto.
- `docs/codemode-guard-parecer.md` (Claude Code): reprodução independente, revisão do diff e do teste, decisão `[APROVADO]` ou `[REJEITADO]`.

Ao terminar, parem e aguardem o dono.
