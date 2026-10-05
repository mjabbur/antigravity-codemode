---
name: codemode
description: >-
  Execute JavaScript in an isolated QuickJS WebAssembly sandbox with built-in
  Ripwire code graph navigation (Personalized PageRank, blast radius, callers)
  and Windows-hardened atomic filesystem staging.
---

# Codemode Plugin for Google Antigravity

Codemode allows you to navigate large codebases and perform multi-file refactorings in milliseconds without burning LLM context on dozens of separate tool calls.

Instead of issuing 20 separate tool calls to explore files or replace lines, write an async JavaScript script and run it through `codemode_run`.

---

## 1. When to Use Codemode

- **Cold Codebase Orientation**: Call `tools["ripwire.map"]` to obtain the top-ranked architectural symbols across the entire repository in < 200ms.
- **Impact & Blast Radius Analysis**: Call `tools["ripwire.impact"]` before making changes to understand all transitive callers and dependents.
- **Refactoring & Multi-File Editing**: Read, inspect, and stage modifications across multiple files in a single turn using `tools.readFile`, `tools.writeFile`, and `tools.editFile`.
- **Finding Usages & Callers**: Call `tools["ripwire.callers"]` or `tools["ripwire.uses"]` to pinpoint all references to a function or interface.

---

## 2. Tools Available Inside `codemode_run`

Within the JavaScript script passed to `codemode_run`, you have access to `tools`:

### 2.1. Ripwire Code Graph
- `await tools["ripwire.map"]({ path?: string, topK?: number, maxTokens?: number })`: Returns PageRank-ordered symbols and file relations.
- `await tools["ripwire.callers"]({ symbol: string, path?: string })`: Direct 1-hop callers of a symbol.
- `await tools["ripwire.impact"]({ symbol: string, path?: string })`: Full transitive blast radius and importing files.
- `await tools["ripwire.uses"]({ symbol: string, path?: string })`: Reads, writes, extensions, and invocations.
- `await tools["ripwire.for"]({ task: string, path?: string })`: Task Lens bundle containing relevant signatures and anchors.
- `await tools["ripwire.around"]({ symbol: string, depth?: number })`: Local ego-graph around a symbol.

### 2.2. Filesystem & Staging
- `await tools.readFile({ path: string, offset?: number, limit?: number })`: Safe reading with partial offsets and 64-bit TOCTOU verification.
- `await tools.glob({ pattern: string, cwd?: string, ignore?: string[] })`: Glob file search confined to workspace.
- `await tools.grep({ query: string, path?: string, isRegex?: boolean, caseSensitive?: boolean })`: Substring and ReDoS-immune regex search.
- `await tools.writeFile({ path: string, content: string })`: Stages file creation or full overwrite in memory.
- `await tools.editFile({ path: string, oldText: string, newText: string })`: Stages exact single-occurrence text replacement without regex backreference traps.
- `await tools.getStagedDiff()`: Generates unified diff of all currently staged changes.
- `await tools.discardStaged()`: Clears the staging area.

> [!IMPORTANT]
> The sandbox uses a **Staging-first** safety model. Files are never written directly to the real disk during `codemode_run`. All mutations produce an in-memory staging diff. You must explicitly call `codemode_apply` to commit changes to disk.

---

## 3. Workflow Examples

### Example 1: Codebase Orientation and Callers
```javascript
// Map the core architecture and find callers of a key function
const map = await tools["ripwire.map"]({ topK: 10 });
const callers = await tools["ripwire.callers"]({ symbol: "resolvePath" });

console.log(`Repository has ${map.files} files and ${map.symbols} indexed symbols.`);
return {
  topFiles: map.r.map(f => f.p),
  callersCount: callers.count,
  callers: callers.callers
};
```

### Example 2: Multi-File Staged Refactoring
```javascript
// Update a version string or config across multiple files in a single atomic operation
const files = await tools.glob({ pattern: "packages/**/package.json" });

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

return { inspected: files.length };
```

---

## 4. Committing Changes
After running a script that stages changes:
1. Inspect the unified diff returned in the output of `codemode_run`.
2. Verify that all replacements and additions are accurate.
3. Call `codemode_apply` to atomically commit the changes to disk with backup and automatic rollback protection.
4. If the diff looks incorrect, call `codemode_discard` to abort.
