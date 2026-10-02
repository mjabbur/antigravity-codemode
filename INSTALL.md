# Installation Guide: Antigravity Codemode

This guide walks you through compiling, installing, and configuring the **Codemode Plugin for Google Antigravity** on your machine. You can install it either **Globally** (automatically active across all projects) or **Locally per Workspace** (scoped to a specific repository).

---

## 1. Prerequisites

Ensure your development environment meets the following requirements:
- **Node.js**: version `>= 20.0.0` (v22 or v24 LTS recommended).
- **npm**: version `>= 9.0.0`.
- **Git**.
- **Google Antigravity**: IDE, Desktop 2.0 application, or CLI (`agy`).
- **Operating System**: Windows 10/11 x64, Linux x64, or macOS (the native Windows x64 Ripwire binary is bundled in `bin/`).

---

## 2. Clone & Build the Project

Open your terminal (PowerShell, bash, or WSL) and clone the repository:

```bash
# 1. Clone the repository
git clone https://github.com/mjabbur/antigravity-codemode.git
cd antigravity-codemode

# 2. Install QuickJS WASM + MCP server dependencies
npm run install:server

# 3. Compile TypeScript to JavaScript (dist/)
npm run build

# 4. Run the 48-test deterministic test suite to verify your setup
npm test
```

> **Verification:** All 48 Vitest unit and invariant tests (QuickJS Sandbox, Windows Security, Ripwire, and MCP Server) should pass with 100% success.

---

## 3. Option A: Global Installation (Recommended)

Global installation registers the MCP server and skills in Antigravity's global configuration directory (`~/.gemini/config/`). This makes `codemode_run`, `codemode_apply`, `codemode_discard`, and the `/codemode` slash command **automatically available across all projects on your machine** without per-project configuration.

### Automated Setup via PowerShell (Windows):

Replace `C:/path/to/antigravity-codemode` with the absolute path where you cloned the repository:

```powershell
$REPO_PATH = "C:/Dev/antigravity-codemode" # adjust to your actual clone directory

# 1. Create global Antigravity directories
New-Item -ItemType Directory -Force -Path "$HOME\.gemini\config\skills\codemode"
New-Item -ItemType Directory -Force -Path "$HOME\.gemini\config\plugins\codemode\skills\codemode"

# 2. Copy Skill and Manifest files
Copy-Item "$REPO_PATH\.agents\skills\codemode\SKILL.md" "$HOME\.gemini\config\skills\codemode\SKILL.md" -Force
Copy-Item "$REPO_PATH\.agents\skills\codemode\SKILL.md" "$HOME\.gemini\config\plugins\codemode\skills\codemode\SKILL.md" -Force
Copy-Item "$REPO_PATH\.agents\plugins\codemode\plugin.json" "$HOME\.gemini\config\plugins\codemode\plugin.json" -Force

# 3. Configure Global MCP Server (~/.gemini/config/mcp_config.json)
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

Write-Host "✅ Codemode successfully installed and registered globally!" -ForegroundColor Green
```

### Manual MCP Server Configuration:

If you already have existing MCP servers configured in `~/.gemini/config/mcp_config.json`, simply add the `"codemode"` entry to your `"mcpServers"` object:

```json
{
  "mcpServers": {
    "codemode": {
      "command": "node",
      "args": [
        "C:/path/to/antigravity-codemode/.agents/plugins/codemode/server/dist/mcp/server.js"
      ],
      "env": {
        "RIPWIRE_PATH": "C:/path/to/antigravity-codemode/bin/ripwire-0.6.5-windows-x64/ripwire.exe"
      }
    }
  }
}
```

> [!TIP]
> In JSON files on Windows, always use forward slashes (`/`) or double backslashes (`\\`) in path values.

---

## 4. Option B: Project / Workspace-Level Installation

If you prefer to restrict Codemode to a specific project (e.g., committing `.agents` to VCS for your team):

1. Copy the `.agents/` directory from this repository into the root of your target project:
   ```bash
   cp -r .agents/ /path/to/your/project/
   ```
2. In `/path/to/your/project/.agents/mcp_config.json`, ensure the paths to `server.js` and `ripwire.exe` point to valid compiled binaries on the host.
3. When opening that project in Antigravity, the agent will discover `.agents/` automatically.

---

## 5. Ripwire Setup on Linux or macOS

This repository includes a pre-packaged native binary for **Windows x64** in `bin/ripwire-0.6.5-windows-x64/ripwire.exe`.

If you are running on **Linux** or **macOS**:
1. Download the corresponding native release from [GitHub: redhat-et/ripwire/releases](https://github.com/redhat-et/ripwire/releases).
2. Extract the `ripwire` executable to a directory of your choice (e.g. `/usr/local/bin/ripwire` or inside `bin/`).
3. Make it executable: `chmod +x ripwire`.
4. Update the `"RIPWIRE_PATH"` environment variable in your `mcp_config.json` to point to that binary.

---

## 6. Verification & Testing

### 6.1. Verification in Google Antigravity
1. Open or restart your Google Antigravity session.
2. In the chat, type `/codemode` or prompt the agent:
   > *"What tools do you have available for codemode?"*
3. The agent should confirm the presence of `codemode_run`, `codemode_apply`, and `codemode_discard`, as well as Ripwire code intelligence.

### 6.2. Standalone MCP Server Check (Optional)
You can directly test the MCP stdio protocol from your terminal:
```bash
node .agents/plugins/codemode/server/dist/mcp/server.js
```
The process will stay active awaiting JSON-RPC messages over stdio (press `Ctrl+C` to stop).

### 6.3. Running the Benchmark Suite
To verify real-world token savings and local performance on your hardware:
```bash
npm run benchmark
```
This runs the 5-scenario statistical benchmark suite and displays a formatted metrics table.

---

## 7. Troubleshooting & FAQ

- **`Cannot find module .../dist/mcp/server.js`:**
  - Run `npm run build` from the repository root to compile TypeScript sources.
- **Path Resolution Errors on Windows:**
  - Avoid unescaped single backslashes `\` in `mcp_config.json`. Use forward slashes `/` or double backslashes `\\`.
- **`Ripwire not found` or error when calling `ripwire.map`:**
  - Verify that the path set in `"RIPWIRE_PATH"` points to an existing, executable binary file.
- **PowerShell Script Execution Policy:**
  - If PowerShell blocks running setup scripts, run: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.
