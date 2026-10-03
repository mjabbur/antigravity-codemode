# Parecer — instalador do ripwire (`feat/ripwire-installer`)

> Claude Code, 2026-10-03. Revisão independente dos commits `a0ba2d5` e `372bd91` (sobre `750f2d7`, na `main`).
> Não editei scripts, testes nem `src/`. Só li, rodei verificações e escrevi este arquivo.

## Decisão: [APROVADO] (rodada 2; a rodada 1 voltou ao agy por dois ajustes)

## Verificação independente

- **`install-ripwire.sh`, Linux real (WSL2 Ubuntu-26.04), rodando de fora do repositório:** instalação limpa (download,
  SHA-256 conferido, extração, `--version` = 0.6.5, linha `RIPWIRE_PATH` impressa); segunda execução idempotente (exit 0,
  sem download); checksum errado aborta com exit 1 e nada é extraído; o binário instalado roda.
- **`install-ripwire.ps1`, Windows, em pasta temporária:** checksum errado aborta e não cria `bin/`; instalação limpa e
  idempotência funcionam; o `ripwire.exe` baixado é byte a byte igual ao de `bin/`
  (SHA-256 `5F7EA0A7603C962B3B68830642D7BF5126BA74D44403F9A49B335A8E7E17C3AF`).
- **Fim de linha:** no commit `a0ba2d5` não havia `.gitattributes`. Com `core.autocrlf=true`, o `.sh` saía em CRLF e falhava
  no Linux com `set: pipefail: invalid option name` (reproduzido). O `372bd91` adiciona `*.sh text eol=lf` e
  `*.ps1 text eol=crlf`; num clone com `autocrlf=true`, o `.sh` fica com 0 CR e o `.ps1` em CRLF.
- **Git:** `install-ripwire.sh` está no índice como `100755`; os diretórios `bin/ripwire-0.6.5-linux-x64/` e `-arm64/`
  estão no `.gitignore`. Nenhum doc de relatório ou parecer foi commitado.

## Observações (não bloqueiam)

1. A variável de teste antiga `TEST_RIPWIRE_EXPECTED_HASH` continua aceita como alternativa à nova
   `RIPWIRE_INSTALL_TEST_HASH_OVERRIDE`. Qualquer uma das duas substitui o hash esperado, então quem controla o ambiente
   consegue casar o hash com um arquivo adulterado. O risco é baixo, pois quem controla o ambiente já controla a máquina,
   mas a variável antiga poderia sair.
2. O caminho `linux-arm64` não foi executado (sem hardware); só o `linux-x64` foi testado. O nome do asset arm64 existe no release.
3. O teste de ferramenta ausente (`curl`, `tar`, `sha256sum`) não foi exercitado de forma válida; o código lê corretamente.
4. O `.exe` continua versionado em `bin/`. Como o script baixa um binário idêntico, ele pode sair do git depois. Decisão do dono.
5. macOS fora do escopo, a pedido do dono: o `.sh` recusa `uname` diferente de Linux, com mensagem clara.
