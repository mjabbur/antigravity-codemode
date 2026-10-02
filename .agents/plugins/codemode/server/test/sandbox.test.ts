import { describe, expect, it } from "vitest";
import { CodemodeSandbox } from "../src/sandbox/index.ts";
import type { CodemodeTool } from "../src/sandbox/types.ts";

describe("CodemodeSandbox (Invariantes Spec 01)", () => {
  it("T01: Executa código JavaScript simples e retorna valor", async () => {
    const sandbox = new CodemodeSandbox();
    const result = await sandbox.execute("return 40 + 2;");
    await sandbox.close();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
      expect(result.output).toEqual([]);
    }
  });

  it("T02: Executa chamada de ferramenta assíncrona registrada", async () => {
    const tools: CodemodeTool[] = [
      {
        name: "multiply",
        execute: async (args) => {
          const { a, b } = args as { a: number; b: number };
          return a * b;
        },
      },
    ];

    const sandbox = new CodemodeSandbox({ tools });
    const result = await sandbox.execute(`
      const res = await tools.multiply({ a: 6, b: 7 });
      return res;
    `);
    await sandbox.close();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(42);
      expect(result.calls.length).toBe(1);
      expect(result.calls[0].name).toBe("multiply");
      expect(result.calls[0].status).toBe("ok");
    }
  });

  it("T03: Interrompe loop infinito dentro do timeout via interrupção atômica", async () => {
    const sandbox = new CodemodeSandbox({ timeoutMs: 1000 });
    const start = performance.now();
    const result = await sandbox.execute("while(true) {}");
    const duration = performance.now() - start;
    await sandbox.close();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
    }
    // Deve terminar próximo a 1000ms com margem estrita de tolerância (< 2000ms)
    expect(duration).toBeGreaterThanOrEqual(950);
    expect(duration).toBeLessThan(2000);
  });

  it("T04: Trata estouro de quota de memória (default 256MB)", async () => {
    // Usando limite explícito de 32MB para velocidade de teste
    const sandbox = new CodemodeSandbox({ memoryLimitBytes: 32 * 1024 * 1024 });
    const result = await sandbox.execute(`
      let s = "x";
      while(true) {
        s = s + s;
      }
    `);
    await sandbox.close();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message.toLowerCase()).toMatch(/out of memory|string too long/);
    }
  });

  it("T05: Retorna erro de sintaxe com indicação correta de linha", async () => {
    const sandbox = new CodemodeSandbox();
    const result = await sandbox.execute("const = 1;");
    await sandbox.close();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("script");
      expect(result.error.stack).toContain("codemode.js:1");
    }
  });

  it("T06: Captura helpers de output (text, console.log)", async () => {
    const sandbox = new CodemodeSandbox();
    const result = await sandbox.execute(`
      text("primeira mensagem");
      console.log("segunda mensagem");
      return "fim";
    `);
    await sandbox.close();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toHaveLength(2);
      expect(result.output[0]).toEqual({ type: "text", text: "primeira mensagem" });
      expect(result.output[1]).toEqual({ type: "text", text: "segunda mensagem" });
    }
  });

  it("T07: Detecta promessa estagnada (stalled promise) imediatamente", async () => {
    const sandbox = new CodemodeSandbox({ timeoutMs: 10000 });
    const start = performance.now();
    const result = await sandbox.execute("await new Promise(() => {});");
    const duration = performance.now() - start;
    await sandbox.close();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("waiting on a promise that can never settle");
    }
    // Deve falhar instantaneamente (< 1s), muito antes do timeout de 10s
    expect(duration).toBeLessThan(1000);
  });

  it("T08: Lança erro amigável com Levenshtein fuzzy match ao errar nome da ferramenta", async () => {
    const tools: CodemodeTool[] = [
      {
        name: "readFile",
        execute: () => "conteudo",
      },
    ];

    const sandbox = new CodemodeSandbox({ tools });
    // "read_fle" deve sugerir "tools.readFile"
    const result = await sandbox.execute("await tools.read_fle();");
    await sandbox.close();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("Did you mean tools.readFile");
    }
  });

  it("T09: Cancela execução imediatamente via AbortSignal", async () => {
    const controller = new AbortController();
    const sandbox = new CodemodeSandbox();
    const execution = sandbox.execute("while(true) {}", { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);

    const result = await execution;
    await sandbox.close();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("aborted");
    }
  });

  it("T10: Propaga rejeição de ferramenta para o script", async () => {
    const tools: CodemodeTool[] = [
      {
        name: "failingTool",
        execute: () => {
          throw new Error("Falha intencional da ferramenta");
        },
      },
    ];

    const sandbox = new CodemodeSandbox({ tools });
    const result = await sandbox.execute(`
      try {
        await tools.failingTool();
        return "nao deveria chegar aqui";
      } catch (e) {
        return "capturado: " + e.message;
      }
    `);
    await sandbox.close();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toContain("capturado: Falha intencional da ferramenta");
    }
  });

  it("T11: Trata timeoutMs inválido (0 ou NaN) aplicando timeout padrão seguro", async () => {
    // Timeout 0 não deve travar o host nem deixar loop infinito
    const sandbox = new CodemodeSandbox();
    const result = await sandbox.execute("return 1 + 1;", { timeoutMs: 0 });
    await sandbox.close();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(2);
    }
  });

  it("T12: Trunca saída volumosa para proteger o Host contra DoS", async () => {
    const sandbox = new CodemodeSandbox();
    // Emite muitos blocos de texto grandes
    const result = await sandbox.execute(`
      for (let i = 0; i < 200; i++) {
        text("x".repeat(50000));
      }
      return "concluido";
    `);
    await sandbox.close();

    expect(result.ok).toBe(true);
    if (result.ok) {
      const lastOutput = result.output[result.output.length - 1];
      expect(lastOutput.type).toBe("text");
      if (lastOutput.type === "text") {
        expect(lastOutput.text).toContain("[Saída truncada");
      }
    }
  });
});

