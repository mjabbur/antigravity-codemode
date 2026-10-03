import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { PathPolicy, SecurityError } from "../src/security/path-policy.ts";
import { createRipwireTools, resolveBinaryPath } from "../src/tools/ripwire.ts";

const localWinBin = path.resolve(__dirname, "../../../../../bin/ripwire-0.6.5-windows-x64/ripwire.exe");
if (!process.env.RIPWIRE_PATH && fs.existsSync(localWinBin)) {
  process.env.RIPWIRE_PATH = localWinBin;
}
const isRipwireAvailable = Boolean(resolveBinaryPath());

describe("Ripwire Availability and Lazy Loading (Spec 03 / E1)", () => {
  it("E1: ferramentas ripwire lançam erro amigável se binário não estiver presente", async () => {
    const fakePolicy = new PathPolicy(path.resolve(__dirname, ".."));
    const tools = createRipwireTools(fakePolicy, { binaryPath: "caminho/inexistente/ripwire" });
    const map = tools.find((t) => t.name === "map")!;
    await expect(map.execute({}, { signal: new AbortController().signal })).rejects.toThrow(
      /Binário do Ripwire não encontrado/
    );
  });
});

describe.skipIf(!isRipwireAvailable)("Ripwire Code Intelligence Integration (Spec 03)", () => {
  const workspaceRoot = path.resolve(__dirname, "..");
  const policy = new PathPolicy(workspaceRoot);
  const ripwireTools = createRipwireTools(policy);

  const mapTool = ripwireTools.find((t) => t.name === "map")!;
  const forTool = ripwireTools.find((t) => t.name === "for")!;
  const callersTool = ripwireTools.find((t) => t.name === "callers")!;
  const usesTool = ripwireTools.find((t) => t.name === "uses")!;
  const impactTool = ripwireTools.find((t) => t.name === "impact")!;
  const aroundTool = ripwireTools.find((t) => t.name === "around")!;

  it("R01: ripwire.map mapeia o código em src/ e retorna JSON estruturado com PageRank", async () => {
    const result = (await mapTool.execute(
      { path: "src", topK: 15, json: true },
      { signal: new AbortController().signal }
    )) as { files: number; symbols: number; r: Array<{ p: string; s: unknown[] }> };

    expect(result).toBeDefined();
    expect(typeof result.files).toBe("number");
    expect(result.files).toBeGreaterThan(0);
    expect(Array.isArray(result.r)).toBe(true);
    expect(result.r.length).toBeGreaterThan(0);

    const hasPathPolicy = result.r.some((file) => file.p.includes("path-policy.ts"));
    expect(hasPathPolicy).toBe(true);
  });

  it("R02: ripwire.callers localiza chamadores diretos de um símbolo (resolvePath)", async () => {
    const result = (await callersTool.execute(
      { symbol: "resolvePath", path: "src" },
      { signal: new AbortController().signal }
    )) as { of: string; count: number; callers: Array<{ n: string; p: string }> };

    expect(result).toBeDefined();
    expect(result.of).toBe("resolvePath");
    expect(result.count).toBeGreaterThan(0);
    expect(Array.isArray(result.callers)).toBe(true);

    const callerFiles = result.callers.map((c) => c.p);
    const hasFsReadOrWrite = callerFiles.some(
      (p) => p.includes("fs-read.ts") || p.includes("fs-write.ts")
    );
    expect(hasFsReadOrWrite).toBe(true);
  });

  it("R03: ripwire.impact calcula raio de impacto e import_reach", async () => {
    const result = (await impactTool.execute(
      { symbol: "resolvePath", path: "src" },
      { signal: new AbortController().signal }
    )) as { of: string; reaches: number; impact: Array<{ n: string; p: string }>; import_reach: Array<{ p: string }> };

    expect(result).toBeDefined();
    expect(result.of).toBe("resolvePath");
    expect(result.reaches).toBeGreaterThan(0);
    expect(Array.isArray(result.impact)).toBe(true);
    expect(Array.isArray(result.import_reach)).toBe(true);

    const importedFiles = result.import_reach.map((i) => i.p);
    expect(importedFiles.some((p) => p.includes("fs-read.ts") || p.includes("fs-write.ts"))).toBe(true);
  });

  it("R04: ripwire.for retorna contexto semântico direcionado para uma tarefa (Task Lens)", async () => {
    const result = (await forTool.execute(
      { task: "verificar caminhos seguros e sandbox quickjs", path: "src" },
      { signal: new AbortController().signal }
    )) as Record<string, unknown>;

    expect(result).toBeDefined();
  });

  it("R05: PathPolicy bloqueia caminhos ilegais repassados ao ripwire", async () => {
    await expect(
      mapTool.execute({ path: "../../windows/win.ini" }, { signal: new AbortController().signal })
    ).rejects.toThrow(SecurityError);

    await expect(
      callersTool.execute({ symbol: "test", path: "\\\\server\\share" }, { signal: new AbortController().signal })
    ).rejects.toThrow(SecurityError);

    await expect(
      impactTool.execute({ symbol: "test", path: ".git/config" }, { signal: new AbortController().signal })
    ).rejects.toThrow(SecurityError);
  });

  it("R06: AbortSignal cancela a execução do Ripwire sem travar o processo", async () => {
    const controller = new AbortController();
    controller.abort(); // Já inicia abortado

    await expect(
      mapTool.execute({ path: "src" }, { signal: controller.signal })
    ).rejects.toThrow(/cancelada ou atingiu o tempo limite/);
  });

  it("R07: Validação de símbolo rejeita caracteres de controle e quebras de linha", async () => {
    await expect(
      callersTool.execute({ symbol: "symbol\ninjection" }, { signal: new AbortController().signal })
    ).rejects.toThrow(/contém caracteres de controle proibidos/);

    await expect(
      impactTool.execute({ symbol: "symbol\0null" }, { signal: new AbortController().signal })
    ).rejects.toThrow(/contém caracteres de controle proibidos/);

    await expect(
      usesTool.execute({ symbol: "" }, { signal: new AbortController().signal })
    ).rejects.toThrow(/obrigatório e deve ser uma string não vazia/);
  });

  it("R08: ripwire.around gera ego-graph com profundidade limitada", async () => {
    const result = (await aroundTool.execute(
      { symbol: "resolvePath", depth: 1, path: "src" },
      { signal: new AbortController().signal }
    )) as Record<string, unknown>;

    expect(result).toBeDefined();
  });
});
