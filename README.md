# Antigravity Codemode

[![Vitest Tests](https://img.shields.io/badge/tests-56%20passing%20(100%25)-success)](file:///c:/Dev/Joker/.agents/plugins/codemode/server/test)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7%20NodeNext-blue)](file:///c:/Dev/Joker/package.json)
[![QuickJS WASM](https://img.shields.io/badge/Engine-QuickJS%20WASI-orange)](https://github.com/justjake/quickjs-emscripten)
[![Ripwire Inside](https://img.shields.io/badge/Code%20Intelligence-Ripwire%20v0.6.5-purple)](https://github.com/redhat-et/ripwire)
[![MCP Protocol](https://img.shields.io/badge/Protocol-Model%20Context%20Protocol%20v1.6-green)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Sub-second code navigation, Personalized PageRank blast radius analysis, and atomic multi-file refactoring for Google Antigravity.**

---

## Why Codemode?

Traditional AI agents interact with codebases through iterative, sequential tool calls across the cloud (*tool-calling loop*):
`grep` -> wait for LLM -> `read_file` -> wait for LLM -> `replace_file` -> ...

This pattern introduces three critical bottlenecks:
1. **Context Window Exhaustion:** Thousands of lines of intermediate source code clutter the LLM context.
2. **High Latency:** Every cloud round-trip costs 2 to 5 seconds (10 round-trips = ~25-30 seconds of idle waiting).
3. **Lack of Transactionality:** If an agent fails on the 4th file of a 5-file refactor, the repository is left in a broken, half-modified state.

**Codemode flips this paradigm:** Instead of streaming entire files to the cloud, the LLM emits a compact, asynchronous JavaScript script that runs **locally inside a secure WebAssembly sandbox on the developer's machine**, filtering, navigating, and transforming code at memory speed.

---

## Benchmark Methodology & Scientific Results

To rigorously evaluate Codemode against traditional sequential tool calling, we established an automated, statistically controlled benchmark suite.

### Evaluation Methodology
- **User-Perceived Latency Model:**
  $$T_{\text{perceived}} = (N_{\text{turns}} \times T_{\text{LLM\_roundtrip}}) + T_{\text{local}}$$
  Where $T_{\text{LLM\_roundtrip}} = 2,200\text{ms}$ (industry empirical average for network transit + token generation on frontier models like Claude 3.5 Sonnet / GPT-4o / Gemini 1.5 Pro), and $T_{\text{local}}$ is raw host CPU time.
- **Token Estimation Model:** $\text{Tokens} = \lceil \text{Payload Bytes} / 4 \rceil$ (canonical heuristic for code and JSON payloads).
- **Statistical Rigor:** $N = 3$ independent runs reporting Mean ($\mu$) and Standard Deviation ($\sigma$) for CPU latency.
- **Hardware & Environment:** Windows 11 x64, 16 CPUs, Node.js v24.19.0, QuickJS WASI 3.6.2, Ripwire v0.6.5.

### Consolidated Scientific Results

| Evaluated Scenario | Metric | Traditional Mode (Normal) | Codemode (WASM + Ripwire) | Real-World Gain |
| :--- | :--- | :---: | :---: | :---: |
| **1. Architectural Mapping**<br>(Scan top 10 core files) | LLM Turns<br>Context Tokens<br>Host Latency (CPU)<br>User-Perceived Latency<br>Atomicity | 11 calls<br>~14,527 tokens<br>13.7 ± 3.1 ms<br>~24.2 s<br>No | **1 call**<br>**~274 tokens**<br>453.9 ± 46.2 ms<br>**~2.7 s**<br>No | **-90.9% turns**<br>**98.1% token savings**<br>Local QuickJS engine<br>**~9.1x faster**<br>Clean & focused |
| **2. Blast Radius & Callers**<br>(Identify callers & impact of `resolvePath`) | LLM Turns<br>Context Tokens<br>Host Latency (CPU)<br>User-Perceived Latency<br>Atomicity | 6 calls<br>~15,857 tokens<br>31.8 ± 1.1 ms<br>~13.2 s<br>No | **1 call**<br>**~450 tokens**<br>609.6 ± 39.7 ms<br>**~2.8 s**<br>No | **-83.3% turns**<br>**97.2% token savings**<br>PageRank + Ego-graph<br>**~4.7x faster**<br>Clean & focused |
| **3. Multi-File Refactoring**<br>(Modify 5 files with validation) | LLM Turns<br>Context Tokens<br>Host Latency (CPU)<br>User-Perceived Latency<br>Atomicity | 10 calls<br>~134 tokens<br>5.5 ± 0.3 ms<br>~22.0 s<br>**No** (partial failure risk) | **2 calls** (run + apply)<br>**~268 tokens** (with diff)<br>126.9 ± 7.4 ms<br>**~4.5 s**<br>**Yes (Atomic Rollback)** | **-80.0% turns**<br>Unified diff for review<br>Transactional in-memory<br>**~4.9x faster**<br>**100% integrity** |
| **4. Task Lens Context Gathering**<br>(Targeted context for "security policy") | LLM Turns<br>Context Tokens<br>Host Latency (CPU)<br>User-Perceived Latency<br>Atomicity | 4 calls<br>~6,229 tokens<br>94.6 ± 6.0 ms<br>~8.9 s<br>No | **1 call**<br>**~31 tokens**<br>1267.2 ± 104.2 ms<br>**~3.5 s**<br>No | **-75.0% turns**<br>**99.5% token savings**<br>Semantic graph anchors<br>**~2.6x faster**<br>Zero noise |

> **Memory & Lifecycle Stress Test (Scenario 5):** 10 consecutive cycles of initializing, executing memory-intensive scripts, and tearing down QuickJS WASM sandboxes completed in 1,073 ms (~107 ms/cycle) with **zero memory leaks** (active RSS variation of -29.04 MB due to prompt V8 and QuickJS garbage collection).
>
> For the in-depth technical analysis of each scenario, see the [Full Scientific Benchmark Report (docs/BENCHMARK_CODEMODE.md)](docs/BENCHMARK_CODEMODE.md).
>
> Reproduce these benchmarks on your machine: `npm run benchmark`.

---

## Core Architecture & Features

### 1. Isolated WebAssembly Sandbox (QuickJS WASI)
- Sterile, isolated environment: no unauthorized network access (`fetch`), arbitrary process execution (`child_process`), or unconstrained `eval`.
- Hard execution deadlines (30s execution watchdog) and memory ceiling (128 MB).
- Fast bidirectional binary IPC protocol between Node.js host and WASM guest.

### 2. Semantic Code Intelligence with Ripwire (Optional & Lazy-Loaded)
- Code graph built and queried in sub-seconds using **Personalized PageRank**.
- **Lazy Loading & Dynamic Discovery:** The MCP server boots cleanly without requiring Ripwire to be pre-installed. The binary is resolved on-demand when a `ripwire.*` tool is invoked, checking `RIPWIRE_PATH` first and then falling back to system `PATH` (e.g. `ripwire` or `ripwire.exe`).
- Exposed APIs inside scripts:
  - `tools["ripwire.map"]`: Architectural overview and most influential repository symbols.
  - `tools["ripwire.callers"]`: Direct 1-hop callers of functions or interfaces.
  - `tools["ripwire.impact"]`: Full transitive blast radius before modifying code.
  - `tools["ripwire.uses"]`: Usages, extensions, reads, and writes across files.
  - `tools["ripwire.for"]`: Task Lens semantic context assembly for natural language tasks.
  - `tools["ripwire.around"]`: Ego-graph surrounding a target symbol up to a specified depth.

### 3. Staging-First Filesystem with Atomic Rollback & POSIX Mode Preservation
- **Zero Real Disk Mutation during `codemode_run`:** All changes are buffered in-memory.
- Automatic **unified diff** generation for human review.
- Optimistic concurrency checking with disk state prior to commit.
- Transactional rollback: if I/O fails on any file in a batch, all previous modifications are atomically reverted.
- **POSIX Mode Preservation:** Pre-existing file permissions (`st_mode`, including executable bit `+x` / `0755` and restricted modes `0600`) are preserved upon `codemode_apply`.
- **Robust Path Traversal:** Gracefully handles intermediate `ENOTDIR` collisions alongside `ENOENT`.

### 4. Multiplatform Hardened Security Layer
- **Universal Containment:** Strict workspace boundary containment, blocking UNC paths (`\\server\share`), Win32 device namespaces (`\\?\`), sensitive metadata folders (`.git`, `.ssh`, `.aws`), and secret credentials (`.env*`, `*.pem`, `*.key`).
- **Platform-Aware Path Validation:**
  - On **Windows**: Blocks MS-DOS reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1..9`, `LPT1..9`), Alternate Data Streams (ADS `:`), trailing dots/spaces, and 8.3 short names (`~1`).
  - On **Linux / POSIX**: Fully supports case-sensitive filesystems (allowing distinct files like `Foo.txt` and `foo.txt` in staging), permits valid POSIX filenames containing colons or dots, and retains POSIX file permissions.
- **Catastrophic Backtracking (ReDoS) Immunity:** Regex evaluation isolated in **dedicated Worker Threads with a 600ms watchdog**.
- **BigInt Identity Verification:** 64-bit BigInt file identity verification (`dev` + `ino`) preventing TOCTOU symlink races.

---

## Quick Start

To install and build Codemode on your machine:

```bash
# 1. Clone the repository
git clone https://github.com/mjabbur/antigravity-codemode.git
cd antigravity-codemode

# 2. Install dependencies & build
npm run install:server
npm run build

# 3. Verify installation with automated tests
npm test
```

**For complete step-by-step setup (Global or Workspace-level in Google Antigravity), see:**  
**[Detailed Installation Guide (INSTALL.md)](INSTALL.md)**

---

## Code Examples

Once installed, use the `/codemode` slash command in Google Antigravity or let the agent autonomously invoke MCP tools when cost-effective.

### Example 1: Codebase Orientation & Caller Analysis
```javascript
// Map repository architecture and locate all callers of `resolvePath`
const map = await tools["ripwire.map"]({ topK: 10 });
const callers = await tools["ripwire.callers"]({ symbol: "resolvePath" });

return {
  totalFiles: map.files,
  topRanked: map.r.map(f => f.p),
  callersCount: callers.count,
  callersList: callers.callers
};
```

### Example 2: Multi-File Staged Refactoring
```javascript
// Safely update version strings across package.json files
const files = await tools.glob({ pattern: "**/package.json" });

for (const file of files) {
  const content = await tools.readFile({ path: file });
  if (content.includes('"version": "1.0.0"')) {
    await tools.editFile({
      path: file,
      oldText: '"version": "1.0.0"',
      newText: '"version": "1.1.0"'
    });
  }
}

// Result outputs the unified diff in staging
return { stagedCount: files.length };
```

After inspecting the staged diff returned by `codemode_run`, approve changes by executing `codemode_apply` (or cancel with `codemode_discard`).

---

## Repository Structure

```
antigravity-codemode/
├── .agents/
│   ├── mcp_config.json                   # Sample Antigravity MCP configuration
│   ├── plugins/codemode/
│   │   ├── plugin.json                   # Plugin manifest
│   │   └── server/                       # Node.js / TypeScript engine
│   │       ├── specs/                    # Formal SDD specifications (Phases 1 to 4)
│   │       ├── src/
│   │       │   ├── sandbox/              # QuickJS WASM, Host, Worker & IPC protocol
│   │       │   ├── security/             # PathPolicy with multiplatform & NTFS containment
│   │       │   ├── tools/                # fs-read, fs-write (staging), ripwire, regex
│   │       │   └── mcp/                  # Stdio MCP server (codemode_run, apply, discard)
│   │       ├── test/                     # 56 Vitest unit & invariant tests
│   │       └── benchmarks/               # Automated statistical benchmark suite
│   ├── rules/
│   │   └── codemode-policy.md            # Agent cost-prioritization guidelines
│   └── skills/
│       └── codemode/SKILL.md             # Slash command instructions (/codemode)
├── bin/
│   └── ripwire-0.6.5-windows-x64/        # Native Windows x64 Ripwire binary
├── docs/
│   ├── USAGE_GUIDE.md                    # In-depth usage guide and code recipes
│   ├── BENCHMARK_CODEMODE.md             # Full scientific benchmark report & methodology
│   ├── PLANO_CODEMODE.md                 # Architectural design and master plan
│   └── TIME_E_METODOLOGIA.md             # SDD governance and agent collaboration model
├── INSTALL.md                            # Complete installation & setup guide
├── HANDOFF.md                            # Operational handoff report
├── MEMORY.md                             # Technical session memory and engineering findings
└── package.json                          # Convenience root scripts (build, test, benchmark)
```

---

## Development Commands

From the root directory:

- **Install server dependencies:** `npm run install:server`
- **Build TypeScript:** `npm run build`
- **Run automated test suite:** `npm test`
- **Execute benchmark suite:** `npm run benchmark`

---

## Additional Documentation

- [Installation Guide (INSTALL.md)](INSTALL.md)
- [Usage Guide & Code Recipes (docs/USAGE_GUIDE.md)](docs/USAGE_GUIDE.md)
- [Scientific Benchmark Report (docs/BENCHMARK_CODEMODE.md)](docs/BENCHMARK_CODEMODE.md)
- [Operational Handoff (HANDOFF.md)](HANDOFF.md)
- [Engineering Memory & Lessons Learned (MEMORY.md)](MEMORY.md)

---

## License

Distributed under the [MIT License](LICENSE).
