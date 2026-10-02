# Guia de Instalação: Antigravity Codemode

Este guia descreve como instalar, compilar e configurar o **Plugin Codemode para Google Antigravity** em sua máquina, seja para uso **Global** (habilitado automaticamente em qualquer projeto) ou **Local por Workspace** (específico de um repositório).

---

## 1. Pré-requisitos

Antes de iniciar, certifique-se de possuir em seu ambiente:
- **Node.js**: versão `>= 20.0.0` (recomendado v22 ou v24).
- **npm**: versão `>= 9.0.0`.
- **Git**.
- **Google Antigravity**: IDE, Desktop 2.0 ou CLI (`agy`).
- **Sistema Operacional**: Windows 10/11 x64, Linux x64 ou macOS (o binário nativo do Ripwire para Windows x64 já acompanha este repositório).

---

## 2. Clonar e Compilar o Projeto

Abra o terminal (PowerShell, Git Bash ou WSL) e clone o repositório:

```bash
# 1. Clone o repositório
git clone https://github.com/mjabbur/antigravity-codemode.git
cd antigravity-codemode

# 2. Instale as dependências do servidor QuickJS WASM + MCP
npm run install:server

# 3. Compile o código TypeScript para JavaScript (dist/)
npm run build

# 4. Execute a suíte de 48 testes determinísticos para validar o ambiente
npm test
```

> **Verificação:** Todos os 48 testes unitários (Sandbox QuickJS, Camada de Segurança Windows, Ripwire e Servidor MCP) devem passar com 100% de sucesso.

---

## 3. Opção A: Instalação Global (Recomendada)

A instalação global registra o servidor MCP e as skills no diretório central do Antigravity (`~/.gemini/config/`), disponibilizando as ferramentas `codemode_run`, `codemode_apply`, `codemode_discard` e o comando `/codemode` **automaticamente em todos os seus projetos**, sem necessidade de configurar nada projeto a projeto.

### Instalação Automática via PowerShell (Windows):

Substitua `C:/caminho/para/antigravity-codemode` pelo caminho absoluto onde você clonou o repositório:

```powershell
$REPO_PATH = "C:/Dev/antigravity-codemode" # ajuste para o caminho real da sua máquina

# 1. Criar diretórios globais do Antigravity
New-Item -ItemType Directory -Force -Path "$HOME\.gemini\config\skills\codemode"
New-Item -ItemType Directory -Force -Path "$HOME\.gemini\config\plugins\codemode\skills\codemode"

# 2. Copiar a Skill e o Manifesto
Copy-Item "$REPO_PATH\.agents\skills\codemode\SKILL.md" "$HOME\.gemini\config\skills\codemode\SKILL.md" -Force
Copy-Item "$REPO_PATH\.agents\skills\codemode\SKILL.md" "$HOME\.gemini\config\plugins\codemode\skills\codemode\SKILL.md" -Force
Copy-Item "$REPO_PATH\.agents\plugins\codemode\plugin.json" "$HOME\.gemini\config\plugins\codemode\plugin.json" -Force

# 3. Configurar o MCP Global (~/.gemini/config/mcp_config.json)
$mcpJson = @"
{
  "mcpServers": {
    "codemode": {
      "command": "node",
      "args": [
        "$REPO_PATH/.agents/plugins/codemode/server/dist/mcp/server.js"
      ],
      "env": {
        "RIPWIRE_PATH": "$REPO_PATH/bin/ripwire-0.6.5-windows-x64/ripwire.exe"
      }
    }
  }
}
"@
Set-Content -Path "$HOME\.gemini\config\mcp_config.json" -Value $mcpJson -Encoding UTF8
Copy-Item "$HOME\.gemini\config\mcp_config.json" "$HOME\.gemini\config\plugins\codemode\mcp_config.json" -Force

Write-Host "✅ Codemode instalado globalmente com sucesso!" -ForegroundColor Green
```

### Configuração Manual do MCP:

Se você já possuir outros servidores MCP cadastrados em `~/.gemini/config/mcp_config.json`, adicione a chave `"codemode"` dentro de `"mcpServers"`:

```json
{
  "mcpServers": {
    "codemode": {
      "command": "node",
      "args": [
        "C:/caminho/para/antigravity-codemode/.agents/plugins/codemode/server/dist/mcp/server.js"
      ],
      "env": {
        "RIPWIRE_PATH": "C:/caminho/para/antigravity-codemode/bin/ripwire-0.6.5-windows-x64/ripwire.exe"
      }
    }
  }
}
```

> [!TIP]
> Em arquivos JSON no Windows, utilize sempre barras normais (`/`) ou barras invertidas duplicadas (`\\`) nos caminhos.

---

## 4. Opção B: Instalação por Workspace / Projeto

Se você preferir disponibilizar o Codemode apenas dentro de um repositório específico da sua equipe (por exemplo, compartilhando com o time via Git):

1. Copie o diretório `.agents/` deste repositório para a raiz do seu projeto de destino:
   ```bash
   cp -r .agents/ /caminho/do/seu/projeto/
   ```
2. No arquivo `/caminho/do/seu/projeto/.agents/mcp_config.json`, certifique-se de que os caminhos para o `server.js` compilado e para o `ripwire.exe` apontem corretamente para os arquivos na sua máquina.
3. Ao abrir o projeto no Antigravity, o agente detectará automaticamente o `.agents/` local.

---

## 5. Configuração do Ripwire em Linux ou macOS

O repositório já inclui o binário nativo para **Windows x64** em `bin/ripwire-0.6.5-windows-x64/ripwire.exe`.

Se você estiver em **Linux** ou **macOS**:
1. Baixe a release nativa correspondente do Ripwire em [GitHub: redhat-et/ripwire/releases](https://github.com/redhat-et/ripwire/releases).
2. Extraia o binário executável `ripwire` em uma pasta de sua preferência (ex: `/usr/local/bin/ripwire` ou dentro de `bin/`).
3. Dê permissão de execução: `chmod +x ripwire`.
4. Ajuste a variável de ambiente `"RIPWIRE_PATH"` no `mcp_config.json` para apontar para o binário extraído.

---

## 6. Verificação e Teste

### 6.1. Teste no Antigravity
1. Abra ou reinicie sua sessão no Google Antigravity.
2. No chat com o agente, digite `/codemode` ou pergunte:
   > *"Quais ferramentas você tem disponíveis para codemode?"*
3. O agente deverá identificar as ferramentas `codemode_run`, `codemode_apply` e `codemode_discard`, além das capacidades de navegação e grafo com Ripwire.

### 6.2. Teste Standalone via Terminal (Opcional)
Você pode testar a inicialização direta do servidor MCP via stdio:
```bash
node .agents/plugins/codemode/server/dist/mcp/server.js
```
O servidor aguardará mensagens do protocolo MCP (pressione `Ctrl+C` para encerrar).

### 6.3. Execução do Benchmark Local
Para verificar o ganho de desempenho e economia de contexto na sua própria máquina:
```bash
npm run benchmark
```
O benchmark executará testes comparativos entre o modo tradicional e o Codemode, exibindo uma tabela com tokens economizados e latência.

---

## 7. Solução de Problemas (Troubleshooting)

- **`Cannot find module .../dist/mcp/server.js`:**
  - Certifique-se de ter executado `npm run build` dentro do repositório para compilar o TypeScript.
- **Erro de caminhos no Windows:**
  - Não utilize barras invertidas simples `\` no `mcp_config.json`. Utilize `/` ou `\\`.
- **`Ripwire not found` ou erro ao invocar `ripwire.map`:**
  - Verifique se o caminho especificado na variável `"RIPWIRE_PATH"` existe e é acessível pelo usuário atual.
- **Permissão de execução no PowerShell:**
  - Se scripts `.ps1` forem bloqueados, execute: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.
