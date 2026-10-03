# Installation Guide: Antigravity Codemode

This guide walks you through compiling, installing, and configuring the **Codemode Plugin for Google Antigravity** on your machine. You can install it either **Globally** (automatically active across all projects) or **Locally per Workspace** (scoped to a specific repository).

---

## 1. Prerequisites

Ensure your development environment meets the following requirements:
- **Node.js**: version `>= 20.0.0` (v22 or v24 LTS recommended).
- **npm**: version `>= 9.0.0`.
- **Git**.
- **Google Antigravity**: IDE, Desktop 2.0 application, or CLI (`agy`).
- **Operating System**: Windows 10/11 x64, Linux x64, or macOS.
- **Ripwire (Optional)**: Provides semantic code intelligence (`ripwire.map`, `ripwire.callers`, `ripwire.impact`, etc.). Automated installer scripts with SHA256 checksum verification are provided in `scripts/install-ripwire.sh` (Linux) and `scripts/install-ripwire.ps1` (Windows). A native Windows x64 binary is bundled in `bin/ripwire-0.6.5-windows-x64/ripwire.exe`. Core sandbox execution (`codemode_run`), file staging, diff inspection, and atomic rollbacks operate completely independently without Ripwire.

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

# 4. Run the 56-test multiplatform test suite to verify your setup
npm test
```

> **Verification:** All 56 Vitest unit and invariant tests (QuickJS Sandbox, Multiplatform Security & Staging, Ripwire, and MCP Server) should pass with 100% success. (Note: On Linux environments without a Ripwire ELF binary configured, Ripwire integration tests are automatically skipped while all sandbox and security invariant tests pass).

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

Write-Host "Codemode successfully installed and registered globally!" -ForegroundColor Green
```

### Manual MCP Server Configuration (Windows, Linux, macOS):

If you already have existing MCP servers configured in `~/.gemini/config/mcp_config.json`, simply add the `"codemode"` entry to your `"mcpServers"` object:

```json
{
  "mcpServers": {
    "codemode": {
      "command": "node",
      "args": [
        "/path/to/antigravity-codemode/.agents/plugins/codemode/server/dist/mcp/server.js"
      ],
      "env": {
        "RIPWIRE_PATH": "/path/to/antigravity-codemode/bin/ripwire-0.6.5-windows-x64/ripwire.exe"
      }
    }
  }
}
```

> [!TIP]
> - On Linux or macOS, `"RIPWIRE_PATH"` is optional if `ripwire` is placed in your system `PATH`.
> - In JSON files on Windows, always use forward slashes (`/`) or double backslashes (`\\`) in path values.

---

## 4. Option B: Project / Workspace-Level Installation

If you prefer to restrict Codemode to a specific project (e.g., committing `.agents` to VCS for your team):

1. Copy the `.agents/` directory from this repository into the root of your target project:
   ```bash
   cp -r .agents/ /path/to/your/project/
   ```
2. In `/path/to/your/project/.agents/mcp_config.json`, ensure the paths to `server.js` point to valid compiled files on the host.
3. When opening that project in Antigravity, the agent will discover `.agents/` automatically.

---

## 5. Ripwire Setup (Linux & Windows)

Ripwire is **optional and lazy-loaded**. The Codemode MCP server starts cleanly and performs all sandbox script execution and staging refactoring even if Ripwire is absent.

### Automated Installation (Recommended)

Automated installation scripts download the official release binaries (v0.6.5), verify their published SHA256 checksums before extraction, extract the binary into the repository's `bin/` directory, and print the configuration line for `mcp_config.json`:

- **On Linux (x64 / arm64):**
  ```bash
  bash scripts/install-ripwire.sh
  ```
- **On Windows (x64):**
  ```powershell
  pwsh -File scripts/install-ripwire.ps1
  # Or with Windows PowerShell:
  powershell -File scripts/install-ripwire.ps1
  ```

Both scripts are idempotent: if Ripwire v0.6.5 is already present, they verify the installed version and exit without re-downloading. They do not require `sudo` or administrator permissions, nor do they modify system PATH, shell profiles, or the Windows Registry.

### Manual Installation (Alternative)

If you prefer to download and verify the binary manually:
1. Download the release binary for your platform from GitHub: [redhat-et/ripwire/releases](https://github.com/redhat-et/ripwire/releases).
2. Download the corresponding `.sha256` checksum file and verify the archive hash.
3. Extract the `ripwire` executable to a directory in your system `PATH` (e.g. `/usr/local/bin/ripwire`) or a directory of your choice.
4. On Linux, ensure executable permissions:
   ```bash
   chmod +x /usr/local/bin/ripwire
   ```
5. If the binary is not in your system `PATH`, configure the `"RIPWIRE_PATH"` environment variable in your `mcp_config.json` pointing to the executable.

---

## 6. Verification & Testing

### 6.1. Verification in Google Antigravity
1. Open or restart your Google Antigravity session.
2. In the chat, type `/codemode` or prompt the agent:
   > *"What tools do you have available for codemode?"*
3. The agent should confirm the presence of `codemode_run`, `codemode_apply`, and `codemode_discard`, as well as Ripwire code intelligence tools if available.

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
- **`Ripwire binary not found` message:**
  - The server starts normally without Ripwire. If a `ripwire.*` tool returns this message, ensure `ripwire` is installed in your system `PATH` or define `RIPWIRE_PATH` in `mcp_config.json`. All sandbox and filesystem tools continue operating normally.
- **PowerShell Script Execution Policy:**
  - If PowerShell blocks running setup scripts, run: `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`.
