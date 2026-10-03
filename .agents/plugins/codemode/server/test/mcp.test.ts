import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import nodeFs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createCodemodeMcpServer, isMainModule } from "../src/mcp/server.ts";

const localWinBin = path.resolve(__dirname, "../../../../../bin/ripwire-0.6.5-windows-x64/ripwire.exe");
if (!process.env.RIPWIRE_PATH && nodeFs.existsSync(localWinBin)) {
  process.env.RIPWIRE_PATH = localWinBin;
}

describe("MCP Server Protocol & Codemode Tool Entrypoints (Spec 04)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codemode-mcp-test-"));
    await fs.writeFile(path.join(tempDir, "sample.txt"), "linha 1\nlinha 2\n");
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("M01: codemode_run executa script e retorna valor de expressão", async () => {
    const { server } = createCodemodeMcpServer({ workspaceRoot: tempDir });
    // Acessa a tool registrada diretamente
    const tool = (server as any)._registeredTools["codemode_run"];
    expect(tool).toBeDefined();

    const response = await tool.handler({ code: "return 21 * 2;" });
    expect(response.isError).toBe(false);
    expect(response.content[0].text).toContain("=== Retorno ===\n42");
  });

  it("M02: codemode_run executa leitura de arquivo e navegação ripwire", async () => {
    const { server } = createCodemodeMcpServer({ workspaceRoot: tempDir });
    const tool = (server as any)._registeredTools["codemode_run"];

    const script = `
      const content = await tools.readFile({ path: "sample.txt" });
      const map = await tools["ripwire.map"]({ topK: 5 });
      console.log("Lido:", content.trim());
      return { length: content.length, hasMap: typeof map === "object" };
    `;

    const response = await tool.handler({ code: script });
    expect(response.isError).toBe(false);
    expect(response.content[0].text).toContain("=== Saída do Script ===");
    expect(response.content[0].text).toContain("Lido: linha 1\nlinha 2");
    expect(response.content[0].text).toContain('"hasMap": true');
  });

  it("M03: codemode_run retém mutações em staging com diff sem alterar disco", async () => {
    const { server } = createCodemodeMcpServer({ workspaceRoot: tempDir });
    const runTool = (server as any)._registeredTools["codemode_run"];

    const script = `
      await tools.writeFile({ path: "novo.txt", content: "conteudo em staging" });
      await tools.editFile({ path: "sample.txt", oldText: "linha 2", newText: "linha 2 editada" });
    `;

    const response = await runTool.handler({ code: script });
    expect(response.isError).toBe(false);

    // Deve exibir o diff no retorno
    const text = response.content[0].text;
    expect(text).toContain("=== Alterações em Staging (Pendente de Aprovação) ===");
    expect(text).toContain("+conteudo em staging");
    expect(text).toContain("+linha 2 editada");

    // O disco FÍSICO não pode ter sido alterado ainda!
    const diskSample = await fs.readFile(path.join(tempDir, "sample.txt"), "utf-8");
    expect(diskSample).toBe("linha 1\nlinha 2\n");

    const existsNew = await fs.access(path.join(tempDir, "novo.txt")).then(() => true).catch(() => false);
    expect(existsNew).toBe(false);
  });

  it("M04: codemode_apply grava alterações no disco e codemode_discard limpa", async () => {
    const { server } = createCodemodeMcpServer({ workspaceRoot: tempDir });
    const runTool = (server as any)._registeredTools["codemode_run"];
    const applyTool = (server as any)._registeredTools["codemode_apply"];
    const discardTool = (server as any)._registeredTools["codemode_discard"];

    // 1. Stage de criação
    await runTool.handler({ code: 'await tools.writeFile({ path: "commit.txt", content: "gravado" });' });

    // 2. Aplica
    const applyRes = await applyTool.handler({});
    expect(applyRes.content[0].text).toContain("Alterações gravadas com sucesso no disco");

    const onDisk = await fs.readFile(path.join(tempDir, "commit.txt"), "utf-8");
    expect(onDisk).toBe("gravado");

    // 3. Novo stage descartado
    await runTool.handler({ code: 'await tools.writeFile({ path: "descartado.txt", content: "nao gravar" });' });
    const discardRes = await discardTool.handler({});
    expect(discardRes.content[0].text).toContain("descartada e limpa");

    const existsDiscarded = await fs.access(path.join(tempDir, "descartado.txt")).then(() => true).catch(() => false);
    expect(existsDiscarded).toBe(false);
  });

  it("M05: codemode_run trata erros de script e timeout amigavelmente", async () => {
    const { server } = createCodemodeMcpServer({ workspaceRoot: tempDir });
    const runTool = (server as any)._registeredTools["codemode_run"];

    // Erro de sintaxe / runtime
    const errRes = await runTool.handler({ code: "throw new Error('falha intencional');" });
    expect(errRes.isError).toBe(true);
    expect(errRes.content[0].text).toContain("=== Erro de Execução ===");
    expect(errRes.content[0].text).toContain("falha intencional");

    // Timeout
    const timeoutRes = await runTool.handler({ code: "while (true) {}", timeoutMs: 100 });
    expect(timeoutRes.isError).toBe(true);
    expect(timeoutRes.content[0].text).toContain("[timeout]");
  });

  it("M06: Garante que applyStaged NÃO está exposto dentro do sandbox", async () => {
    const { server } = createCodemodeMcpServer({ workspaceRoot: tempDir });
    const runTool = (server as any)._registeredTools["codemode_run"];

    const script = `
      try {
        await tools.applyStaged();
        return "exposed";
      } catch (err) {
        return "rejected: " + err.message;
      }
    `;

    const response = await runTool.handler({ code: script });
    expect(response.isError).toBe(false);
    expect(response.content[0].text).toContain("rejected:");
  });

  it("M07: isMainModule detecta ponto de entrada principal conforme a plataforma", () => {
    if (process.platform === "win32") {
      // 1. Caminho exato com unidade maiúscula e barras invertidas
      const metaUrlUpper = "file:///C:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js";
      expect(isMainModule(metaUrlUpper, "C:\\Dev\\Joker\\.agents\\plugins\\codemode\\server\\dist\\mcp\\server.js")).toBe(true);

      // 2. Variação com unidade minúscula no argv
      expect(isMainModule(metaUrlUpper, "c:\\Dev\\Joker\\.agents\\plugins\\codemode\\server\\dist\\mcp\\server.js")).toBe(true);

      // 3. Variação com unidade maiúscula no argv e minúscula no import.meta.url
      const metaUrlLower = "file:///c:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js";
      expect(isMainModule(metaUrlLower, "C:\\Dev\\Joker\\.agents\\plugins\\codemode\\server\\dist\\mcp\\server.js")).toBe(true);

      // 4. Variação com barras normais (forward slashes)
      expect(isMainModule(metaUrlUpper, "c:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js")).toBe(true);

      // 5. Caminho contendo espaços
      const metaUrlSpaces = "file:///C:/Program%20Files/Meu%20Agente/server.js";
      expect(isMainModule(metaUrlSpaces, "C:\\Program Files\\Meu Agente\\server.js")).toBe(true);
      expect(isMainModule(metaUrlSpaces, "c:\\Program Files\\Meu Agente\\server.js")).toBe(true);
    } else {
      // Cenários POSIX (Linux / macOS)
      const metaUrl = "file:///home/user/project/dist/mcp/server.js";
      expect(isMainModule(metaUrl, "/home/user/project/dist/mcp/server.js")).toBe(true);

      const metaUrlSpaces = "file:///home/user/meu%20projeto/dist/mcp/server.js";
      expect(isMainModule(metaUrlSpaces, "/home/user/meu projeto/dist/mcp/server.js")).toBe(true);
    }

    // 6. Tratamento de argv[1] indefinido ou vazio
    const dummyUrl = process.platform === "win32"
      ? "file:///C:/Dev/Joker/.agents/plugins/codemode/server/dist/mcp/server.js"
      : "file:///home/user/project/dist/mcp/server.js";
    expect(isMainModule(dummyUrl, undefined)).toBe(false);
    expect(isMainModule(dummyUrl, "")).toBe(false);

    // 7. Script diferente (não é o entrypoint)
    const otherScript = process.platform === "win32"
      ? "C:\\Dev\\Joker\\other-script.js"
      : "/home/user/other-script.js";
    expect(isMainModule(dummyUrl, otherScript)).toBe(false);
  });
});

