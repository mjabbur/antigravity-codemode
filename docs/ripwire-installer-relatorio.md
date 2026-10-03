# Relatorio de Implementacao: Instaladores Automatizados do Ripwire

> **Autor:** Antigravity (agy)  
> **Data:** 03/10/2026  
> **Branch de Trabalho:** `feat/ripwire-installer` (ramificada a partir de `main`, sem merge)  
> **Commit:** `a0ba2d5`  
> **Status:** Concluido, Testado e Homologado no Windows (pronto para revisao do Claude Code no WSL)  

---

## 1. Escopo e Implementacao

Foram criados dois scripts de instalacao automatizada do Ripwire v0.6.5, sem dependencias externas alem das ferramentas padrao do sistema, sem exigir privilegios de administrador (`sudo`), e sem realizar alteracoes em variaveis de ambiente de sistema, profiles de shell ou registro do Windows:

1. **`scripts/install-ripwire.ps1` (Windows x64):**
   - Utiliza `$ErrorActionPreference = 'Stop'` e `$ProgressPreference = 'SilentlyContinue'`.
   - Versao fixa `0.6.5` no topo (`$RipwireVersion = "0.6.5"`).
   - Valida arquitetura do sistema operacional (64-bit).
   - Resolve a raiz do repositorio dinamicamente a partir do local do script (`$PSScriptRoot/..`).
   - Verifica idempotencia: se `bin/ripwire-0.6.5-windows-x64/ripwire.exe` ja existir e a execucao de `--version` contiver `0.6.5`, exibe a versao, imprime a linha formatada para `mcp_config.json` e encerra com codigo 0 sem novo download.
   - Baixa os assets oficiais via `Invoke-WebRequest`:
     - `https://github.com/redhat-et/ripwire/releases/download/v0.6.5/ripwire-0.6.5-windows-x64.zip`
     - `https://github.com/redhat-et/ripwire/releases/download/v0.6.5/ripwire-0.6.5-windows-x64.zip.sha256`
   - Le o hash SHA256 esperado e computa o hash do arquivo baixado via `Get-FileHash -Algorithm SHA256`.
   - Se os hashes nao baterem, aborta imediatamente com erro sem extrair.
   - Permite injecao de teste via `$env:TEST_RIPWIRE_EXPECTED_HASH` para simular falhas de integridade.
   - Extrai via `Expand-Archive -Force` para `bin/` da raiz do repositorio.
   - Ao final, executa `ripwire.exe --version` e imprime a configuracao pronta para colar no `mcp_config.json`:
     `"RIPWIRE_PATH": "<caminho_com_barras_normais>/bin/ripwire-0.6.5-windows-x64/ripwire.exe"`
   - Limpa diretorio temporario no bloco `finally`.

2. **`scripts/install-ripwire.sh` (Linux x64 e arm64):**
   - Utiliza `set -euo pipefail`.
   - Versao fixa `0.6.5` no topo (`RIPWIRE_VERSION="0.6.5"`).
   - Valida sistema operacional (`uname -s == Linux`) e arquitetura (`x86_64` -> `linux-x64`, `aarch64`/`arm64` -> `linux-arm64`).
   - Valida presenca de `curl`, `tar` e `sha256sum`.
   - Resolve a raiz do repositorio a partir de `BASH_SOURCE[0]`.
   - Verifica idempotencia: se `bin/ripwire-0.6.5-<platform>/ripwire` ja existir e `--version` contiver `0.6.5`, exibe a versao, imprime a linha formatada para `mcp_config.json` e encerra com codigo 0 sem download.
   - Baixa arquivo `.tar.gz` e respectivo `.sha256`.
   - Valida integridade com `sha256sum -c`.
   - Permite injecao de teste via `TEST_RIPWIRE_EXPECTED_HASH`.
   - Extrai via `tar -xzf` para `bin/` na raiz do repositorio e aplica `chmod +x`.
   - Registrado no Git com permissoes executaveis `100755` e terminadores de linha normalizados em LF (`\n`).

3. **Atualizacoes de Documentacao:**
   - [`INSTALL.md`](file:///C:/Dev/Joker/INSTALL.md): Atualizada secao 1 (prerequisitos) e secao 5 (Ripwire Setup) com instrucoes de instalacao automatizada para Linux e Windows, mantendo os passos manuais como alternativa.
   - [`README.md`](file:///C:/Dev/Joker/README.md): Adicionada mencao aos scripts automatizados na secao de arquitetura do Ripwire, na arvore de diretorios do repositorio e na lista de comandos uteis.
   - Zero emojis ou figurinhas em todos os arquivos alterados e criados.

---

## 2. Testes Executados e Resultados

### Teste 1: Idempotencia no Repositorio Existente (Windows x64)
- **Comando:** `pwsh -File scripts/install-ripwire.ps1`
- **Comportamento esperado:** Detectar o `bin/ripwire-0.6.5-windows-x64/ripwire.exe` ja existente na raiz do projeto, validar a versao 0.6.5 e encerrar com sucesso sem realizar requisicoes de rede.
- **Resultado:**
  ```text
  Ripwire v0.6.5 is already installed at: C:\Dev\Joker\bin\ripwire-0.6.5-windows-x64\ripwire.exe
  ripwire 0.6.5 (Release, Clang 20.1.8, emit=std::print, built_from=3fcd515ff)

  Configuration for mcp_config.json:
    "RIPWIRE_PATH": "C:/Dev/Joker/bin/ripwire-0.6.5-windows-x64/ripwire.exe"
  ```
  Status: **Aprovado (exit code 0, sem download)**.

### Teste 2: Instalacao Limpa em Repositorio Temporario Isolado
- **Procedimento:** Criado diretorio temporario em `$env:TEMP`, copiado `scripts/install-ripwire.ps1` e executado o fluxo completo do zero.
- **Resultado:**
  - Download realizado com sucesso (`ripwire-0.6.5-windows-x64.zip` e `.sha256`).
  - Hash SHA256 verificado: `1492F352218D912F7ADAB69651E74981DE0532E5907472DB6EAE755E97BC389F`.
  - Extracao realizada para a pasta `bin/` do diretorio temporario.
  - Execucao de `ripwire.exe --version` retornou `ripwire 0.6.5 (Release, Clang 20.1.8, emit=std::print, built_from=3fcd515ff)`.
  - Segunda execucao consecutiva no mesmo diretorio temporario ativou o modo idempotente com sucesso.
  - Diretorio temporario limpo.
  Status: **Aprovado**.

### Teste 3: Simulacao de Falha de Checksum SHA256 (Windows x64)
- **Procedimento:** Executado `scripts/install-ripwire.ps1` com `$env:TEST_RIPWIRE_EXPECTED_HASH = "0000000000000000000000000000000000000000000000000000000000000000"`.
- **Resultado:**
  - O script abortou antes da extracao com a mensagem:
    ```text
    Error: SHA256 checksum verification failed for ripwire-0.6.5-windows-x64.zip!
    Expected: 0000000000000000000000000000000000000000000000000000000000000000
    Actual:   1492F352218D912F7ADAB69651E74981DE0532E5907472DB6EAE755E97BC389F
    Aborting installation without extracting.
    ```
  - Confirmado via `Test-Path` que nenhum executavel foi gravado em `bin/`.
  - Diretorio temporario limpo.
  Status: **Aprovado**.

### Teste 4: Sintaxe e Verificacao do Script Linux (`scripts/install-ripwire.sh`)
- **Validacao de Sintaxe:** `bash -n scripts/install-ripwire.sh` -> 0 erros.
- **Execucao Real em Ambiente Linux (WSL):**
  - Download de `ripwire-0.6.5-linux-x64.tar.gz` e `.sha256`.
  - Hash verificado: `5c5794612f5f06632ada7c27a0f5c8f400748a70f707b64ec4d238c4fba2f7ea`.
  - Extracao e execucao bem-sucedidas: `ripwire 0.6.5 (Release, GNU 14.2.1, emit=std::print, built_from=unknown)`.
- **Simulacao de Falha de Checksum:**
  - Executado com `TEST_RIPWIRE_EXPECTED_HASH="0000..."` -> abortou com codigo 1 e mensagem de erro antes da extracao.
- **Limpeza:** A pasta `bin/ripwire-0.6.5-linux-x64/` gerada no teste foi removida para garantir ambiente limpo para revisao pelo Claude Code.
Status: **Aprovado**.

---

## 3. Resumo de Commits e Integridade

- **Branch:** `feat/ripwire-installer`
- **Commit unico:** `a0ba2d5` (`feat(scripts): add automated Ripwire installer scripts for Linux and Windows with SHA256 verification`)
- **Arquivos commitados:**
  - `scripts/install-ripwire.ps1` (novo)
  - `scripts/install-ripwire.sh` (novo, modo 100755)
  - `INSTALL.md` (atualizado)
  - `README.md` (atualizado)
- **Arquivos intocados e nao commitados:**
  - `.agents/rules/codemode-policy.md` (intocado)
  - `docs/*.md` (nao commitados)
  - `pi/` (intocado)
  - `C:\Dev\Horus` (intocado)

---

## 4. Rodada 2 — Ajustes Pos-Revisao WSL

Apos revisao e testes do Claude Code em Linux real (WSL), foram implementados os ajustes solicitados no commit:

* **Commit `372bd91`:** `fix(scripts): enforce LF for sh via gitattributes, ignore linux ripwire binaries, and refine installer checks`

### 4.1. Criacao do `.gitattributes`
- **Problema:** Em sistemas Windows com `core.autocrlf=true`, um `git clone` convertia `scripts/install-ripwire.sh` para CRLF (`\r\n`), causando erro no WSL/Linux (`set: pipefail: invalid option name`).
- **Solucao:** Criado arquivo `.gitattributes` na raiz do repositorio com:
  ```gitattributes
  *.sh text eol=lf
  *.ps1 text eol=crlf
  ```
- **Validacoes Realizadas:**
  1. `git ls-files --eol scripts`:
     ```text
     i/lf    w/crlf  attr/text eol=crlf    	scripts/install-ripwire.ps1
     i/lf    w/lf    attr/text eol=lf      	scripts/install-ripwire.sh
     ```
  2. **Clone temporario com `core.autocrlf=true`:**
     Executado `git -c core.autocrlf=true clone --branch feat/ripwire-installer . <temp_dir>`. Inspecionados os bytes brutos do arquivo `scripts/install-ripwire.sh` no clone: confirmou que **zero bytes CR (`\r`, byte 13)** foram gerados no arquivo em disco, garantindo execucao limpa em qualquer ambiente Linux/WSL.

### 4.2. Atualizacao do `.gitignore`
- **Problema:** As pastas `bin/ripwire-0.6.5-linux-x64/` e `bin/ripwire-0.6.5-linux-arm64/` geradas pelo instalador poderiam ser commitadas por engano.
- **Solucao:** Adicionadas ao `.gitignore` na raiz do repositorio:
  ```gitignore
  # Ripwire Linux binaries
  bin/ripwire-0.6.5-linux-x64/
  bin/ripwire-0.6.5-linux-arm64/
  ```
- **Validacao:** Criados diretorios dummy com arquivos dentro e rodado `git status --porcelain`: confirmou que as pastas Linux sao totalmente ignoradas pelo Git, enquanto o binario Windows versionado (`bin/ripwire-0.6.5-windows-x64/ripwire.exe`) continua normalmente rastreado.

### 4.3. Refinamentos nos Scripts de Instalacao
- **Variavel de teste explicita:** Renomeada de `TEST_RIPWIRE_EXPECTED_HASH` para `RIPWIRE_INSTALL_TEST_HASH_OVERRIDE` em ambos os scripts (com fallback para compatibilidade).
- **Match estrito de versao:**
  - No `.sh`: ajustado de `grep -q "${RIPWIRE_VERSION}"` para `grep -qF "ripwire ${RIPWIRE_VERSION} "` para evitar casamento com versoes como `0.6.50`.
  - No `.ps1`: ajustado para `-like "ripwire $RipwireVersion *"`.

### 4.4. Re-execucao dos Testes
1. **Idempotencia no Windows (`scripts/install-ripwire.ps1`):**
   - Executado: detectou `bin/ripwire-0.6.5-windows-x64/ripwire.exe` com a nova expressao estrita `ripwire 0.6.5 *`, exibiu configuracao e encerrou com codigo 0 sem novo download.
2. **Simulacao de Falha de Checksum (`scripts/install-ripwire.ps1`):**
   - Executado com `$env:RIPWIRE_INSTALL_TEST_HASH_OVERRIDE = "0000..."`: capturou erro esperado de SHA256 divergente, abortou antes da extracao e garantiu que o binario alvo nao foi criado.
3. **Simulacao de Falha de Checksum (`scripts/install-ripwire.sh`):**
   - Executado com `RIPWIRE_INSTALL_TEST_HASH_OVERRIDE="0000..."`: abortou com codigo de saida 1 e mensagem de erro antes da extracao.

