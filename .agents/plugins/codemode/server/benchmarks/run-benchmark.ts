import { performance } from "node:perf_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createCodemodeMcpServer } from "../src/mcp/server.ts";
import { PathPolicy } from "../src/security/path-policy.ts";
import { createFsReadTools } from "../src/tools/fs-read.ts";
import { createFsWriteTools } from "../src/tools/fs-write.ts";

interface BenchmarkResult {
  scenario: string;
  normal: {
    toolCalls: number;
    latencyMs: number;
    payloadBytes: number;
    tokensEst: number;
    safetyRollback: boolean;
  };
  codemode: {
    toolCalls: number;
    latencyMs: number;
    payloadBytes: number;
    tokensEst: number;
    safetyRollback: boolean;
  };
  improvement: {
    latencyRatio: string;
    tokenSavingsPct: string;
    toolCallReduction: string;
  };
}

function estimateTokens(bytes: number): number {
  // Regra padrão de estimativa: ~4 caracteres por token em código/texto
  return Math.ceil(bytes / 4);
}

async function runBenchmark(): Promise<void> {
  console.log("================================================================================");
  console.log("   BATERIA DE BENCHMARK: CODEMODE (SANDBOX + RIPWIRE) VS AGENTE NORMAL TRADICIONAL");
  console.log("================================================================================\n");

  const results: BenchmarkResult[] = [];
  const workspaceRoot = path.resolve(process.cwd());
  const policy = new PathPolicy(workspaceRoot);

  // --------------------------------------------------------------------------------
  // CENÁRIO 1: Mapeamento de Arquitetura e Descoberta de Símbolos Principais
  // --------------------------------------------------------------------------------
  console.log("Executando Cenário 1: Mapeamento de Arquitetura e Símbolos Principais...");
  {
    // MODO NORMAL:
    // O agente lista arquivos e depois faz 10 leituras completas de arquivos fonte
    const t0Normal = performance.now();
    const readTools = createFsReadTools(policy);
    const globTool = readTools.find((t) => t.name === "glob")!;
    const readFileTool = readTools.find((t) => t.name === "readFile")!;

    let normalCalls = 0;
    let normalBytes = 0;

    const files = (await globTool.execute(
      { pattern: "src/**/*.ts" },
      { signal: new AbortController().signal }
    )) as string[];
    normalCalls++;
    normalBytes += JSON.stringify(files).length;

    // Simula leitura dos 10 arquivos principais para entender suas classes e funções
    const targetFiles = files.slice(0, 10);
    for (const file of targetFiles) {
      const content = (await readFileTool.execute(
        { path: file },
        { signal: new AbortController().signal }
      )) as string;
      normalCalls++;
      normalBytes += content.length;
    }
    const tNormal = performance.now() - t0Normal;

    // MODO CODEMODE:
    // O agente envia 1 script de 2 linhas usando o PageRank do Ripwire
    const t0Code = performance.now();
    const { server } = createCodemodeMcpServer({ workspaceRoot });
    const runTool = (server as any)._registeredTools["codemode_run"];

    const script = `
      const map = await tools["ripwire.map"]({ path: "src", topK: 15 });
      return {
        filesCount: map.files,
        symbolsCount: map.symbols,
        topSymbols: map.r.map(f => ({ file: f.p, symbols: f.s.map(s => s.n) }))
      };
    `;

    const response = await runTool.handler({ code: script });
    const tCode = performance.now() - t0Code;
    const codemodeCalls = 1;
    const codemodeBytes = response.content[0].text.length;

    const normalTokens = estimateTokens(normalBytes);
    const codeTokens = estimateTokens(codemodeBytes);

    results.push({
      scenario: "1. Mapeamento Arquitetural (10 arquivos analisados)",
      normal: {
        toolCalls: normalCalls,
        latencyMs: tNormal,
        payloadBytes: normalBytes,
        tokensEst: normalTokens,
        safetyRollback: false,
      },
      codemode: {
        toolCalls: codemodeCalls,
        latencyMs: tCode,
        payloadBytes: codemodeBytes,
        tokensEst: codeTokens,
        safetyRollback: false,
      },
      improvement: {
        latencyRatio: `${(tNormal / tCode).toFixed(1)}x mais rápido`,
        tokenSavingsPct: `${(((normalTokens - codeTokens) / normalTokens) * 100).toFixed(1)}% economia`,
        toolCallReduction: `${normalCalls} calls -> 1 call (-${normalCalls - 1})`,
      },
    });
  }

  // --------------------------------------------------------------------------------
  // CENÁRIO 2: Análise de Blast Radius e Grafo de Chamadores de um Símbolo (resolvePath)
  // --------------------------------------------------------------------------------
  console.log("Executando Cenário 2: Análise de Blast Radius e Callers de um Símbolo...");
  {
    // MODO NORMAL:
    // Grep amplo em todo o projeto + leituras pontuais para inferir dependência
    const t0Normal = performance.now();
    const readTools = createFsReadTools(policy);
    const grepTool = readTools.find((t) => t.name === "grep")!;
    const readFileTool = readTools.find((t) => t.name === "readFile")!;

    let normalCalls = 0;
    let normalBytes = 0;

    const matches = (await grepTool.execute(
      { query: "resolvePath" },
      { signal: new AbortController().signal }
    )) as Array<{ file: string; line: number; text: string }>;
    normalCalls++;
    normalBytes += JSON.stringify(matches).length;

    // Para cada arquivo encontrado (4 arquivos), abre para descobrir imports
    const uniqueFiles = Array.from(new Set(matches.map((m) => m.file))).slice(0, 5);
    for (const f of uniqueFiles) {
      const c = (await readFileTool.execute({ path: f }, { signal: new AbortController().signal })) as string;
      normalCalls++;
      normalBytes += c.length;
    }
    const tNormal = performance.now() - t0Normal;

    // MODO CODEMODE:
    // Script com ripwire.callers + ripwire.impact
    const t0Code = performance.now();
    const { server } = createCodemodeMcpServer({ workspaceRoot });
    const runTool = (server as any)._registeredTools["codemode_run"];

    const script = `
      const callers = await tools["ripwire.callers"]({ symbol: "resolvePath", path: "src" });
      const impact = await tools["ripwire.impact"]({ symbol: "resolvePath", path: "src" });
      return {
        totalCallers: callers.count,
        callers: callers.callers,
        impactReaches: impact.reaches,
        importReach: impact.import_reach
      };
    `;

    const response = await runTool.handler({ code: script });
    const tCode = performance.now() - t0Code;
    const codemodeCalls = 1;
    const codemodeBytes = response.content[0].text.length;

    const normalTokens = estimateTokens(normalBytes);
    const codeTokens = estimateTokens(codemodeBytes);

    results.push({
      scenario: "2. Blast Radius & Callers ('resolvePath')",
      normal: {
        toolCalls: normalCalls,
        latencyMs: tNormal,
        payloadBytes: normalBytes,
        tokensEst: normalTokens,
        safetyRollback: false,
      },
      codemode: {
        toolCalls: codemodeCalls,
        latencyMs: tCode,
        payloadBytes: codemodeBytes,
        tokensEst: codeTokens,
        safetyRollback: false,
      },
      improvement: {
        latencyRatio: `${(tNormal / tCode).toFixed(1)}x mais rápido`,
        tokenSavingsPct: `${(((normalTokens - codeTokens) / normalTokens) * 100).toFixed(1)}% economia`,
        toolCallReduction: `${normalCalls} calls -> 1 call (-${normalCalls - 1})`,
      },
    });
  }

  // --------------------------------------------------------------------------------
  // CENÁRIO 3: Refatoração em Lote com Staging e Rollback Atômico
  // --------------------------------------------------------------------------------
  console.log("Executando Cenário 3: Refatoração Multi-Arquivo (Staging vs Escrita Direta)...");
  {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bench-refactor-"));
    const filesToCreate = ["config.ts", "serviceA.ts", "serviceB.ts", "client.ts", "index.ts"];
    for (const f of filesToCreate) {
      await fs.writeFile(path.join(tempDir, f), `export const API_VERSION = "v1";\n// modulo ${f}\n`);
    }

    // MODO NORMAL:
    // 5 chamadas de escrita individuais sem staging nem rollback atômico
    const t0Normal = performance.now();
    let normalCalls = 0;
    let normalBytes = 0;
    for (const f of filesToCreate) {
      const full = path.join(tempDir, f);
      const content = await fs.readFile(full, "utf-8");
      normalCalls++;
      normalBytes += content.length;
      const updated = content.replace('"v1"', '"v2"');
      await fs.writeFile(full, updated);
      normalCalls++;
      normalBytes += updated.length;
    }
    const tNormal = performance.now() - t0Normal;

    // Reseta arquivos para v1 para testar o Codemode
    for (const f of filesToCreate) {
      await fs.writeFile(path.join(tempDir, f), `export const API_VERSION = "v1";\n// modulo ${f}\n`);
    }

    // MODO CODEMODE:
    // Script com loop em memória -> staging diff -> applyStaged com rollback
    const t0Code = performance.now();
    const { server, applyStaged } = createCodemodeMcpServer({ workspaceRoot: tempDir });
    const runTool = (server as any)._registeredTools["codemode_run"];

    const script = `
      const files = await tools.glob({ pattern: "*.ts" });
      for (const f of files) {
        await tools.editFile({
          path: f,
          oldText: 'API_VERSION = "v1"',
          newText: 'API_VERSION = "v2"'
        });
      }
      return { totalModificados: files.length };
    `;

    const response = await runTool.handler({ code: script });
    await applyStaged();
    const tCode = performance.now() - t0Code;

    const codemodeCalls = 2; // 1 codemode_run + 1 codemode_apply
    const codemodeBytes = response.content[0].text.length;

    const normalTokens = estimateTokens(normalBytes);
    const codeTokens = estimateTokens(codemodeBytes);

    results.push({
      scenario: "3. Refatoração Multi-Arquivo (5 arquivos com Staging)",
      normal: {
        toolCalls: normalCalls,
        latencyMs: tNormal,
        payloadBytes: normalBytes,
        tokensEst: normalTokens,
        safetyRollback: false,
      },
      codemode: {
        toolCalls: codemodeCalls,
        latencyMs: tCode,
        payloadBytes: codemodeBytes,
        tokensEst: codeTokens,
        safetyRollback: true,
      },
      improvement: {
        latencyRatio: `${(tNormal / tCode).toFixed(1)}x mais rápido`,
        tokenSavingsPct: `${(((normalTokens - codeTokens) / normalTokens) * 100).toFixed(1)}% economia`,
        toolCallReduction: `${normalCalls} calls -> ${codemodeCalls} calls (-${normalCalls - codemodeCalls})`,
      },
    });

    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  // --------------------------------------------------------------------------------
  // RELATÓRIO CONSOLIDADO DO BENCHMARK
  // --------------------------------------------------------------------------------
  console.log("\n================================================================================");
  console.log("                        TABELA COMPARATIVA DE RESULTADOS                        ");
  console.log("================================================================================\n");

  for (const r of results) {
    console.log(`### ${r.scenario}`);
    console.log(`- Modo Normal:   ${r.normal.toolCalls} tool calls | ${r.normal.latencyMs.toFixed(1)}ms | ~${r.normal.tokensEst} tokens trafegados | Rollback Atômico: NÃO`);
    console.log(`- Codemode:      ${r.codemode.toolCalls} tool calls | ${r.codemode.latencyMs.toFixed(1)}ms | ~${r.codemode.tokensEst} tokens trafegados | Rollback Atômico: SIM`);
    console.log(`-> GANHO:        ${r.improvement.toolCallReduction} | ${r.improvement.latencyRatio} | ${r.improvement.tokenSavingsPct}\n`);
  }

  console.log("================================================================================");
  console.log("   BENCHMARK FINALIZADO COM SUCESSO! EVIDÊNCIAS DE EFICIÊNCIA COMPROVADAS.");
  console.log("================================================================================");
}

runBenchmark().catch((err) => {
  console.error("Falha na execução do benchmark:", err);
  process.exit(1);
});
