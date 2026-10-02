import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { CodemodeSandbox } from "../sandbox/index.ts";
import { PathPolicy } from "../security/path-policy.ts";
import { createFsReadTools } from "../tools/fs-read.ts";
import { createFsWriteTools } from "../tools/fs-write.ts";
import { createRipwireTools } from "../tools/ripwire.ts";

export interface CreateMcpServerOptions {
  workspaceRoot?: string;
  ripwireBinaryPath?: string;
  defaultTimeoutMs?: number;
}

export function createCodemodeMcpServer(options: CreateMcpServerOptions = {}): {
  server: McpServer;
  policy: PathPolicy;
  applyStaged: () => Promise<string[]>;
  discardStaged: () => Promise<void>;
  getStagedDiff: () => Promise<string>;
} {
  const root = path.resolve(options.workspaceRoot ?? process.cwd());
  const policy = new PathPolicy(root);

  // Instancia ferramentas de leitura, escrita (staging) e inteligência de código
  const readTools = createFsReadTools(policy);
  const writeTools = createFsWriteTools(policy);
  const ripwireTools = createRipwireTools(policy, {
    binaryPath: options.ripwireBinaryPath,
  });

  const getDiffTool = writeTools.find((t) => t.name === "getStagedDiff")!;
  const applyTool = writeTools.find((t) => t.name === "applyStaged")!;
  const discardTool = writeTools.find((t) => t.name === "discardStaged")!;

  // O applyStaged NÃO é exposto dentro do sandbox QuickJS para evitar que scripts
  // do modelo gravem diretamente no disco sem aprovação explícita (Staging-first).
  const sandboxTools = [
    ...readTools,
    ...writeTools.filter((t) => t.name !== "applyStaged"),
  ];

  // Ferramentas do Ripwire registradas com namespace tools.ripwire.*
  for (const rwTool of ripwireTools) {
    sandboxTools.push({
      ...rwTool,
      name: `ripwire.${rwTool.name}`,
    });
  }

  const server = new McpServer({
    name: "antigravity-codemode",
    version: "1.0.0",
  });

  // 1. Ferramenta principal: codemode_run
  server.tool(
    "codemode_run",
    "Executa código JavaScript no sandbox QuickJS do Codemode com acesso ao filesystem e navegação estrutural Ripwire. Mutações de escrita são mantidas em staging.",
    {
      code: z.string().describe("Script JavaScript assíncrono para executar no sandbox."),
      timeoutMs: z.number().int().positive().optional().describe("Tempo limite em ms (padrão: 60.000ms)."),
    },
    async ({ code, timeoutMs }) => {
      const sandbox = new CodemodeSandbox({
        tools: sandboxTools,
        timeoutMs: timeoutMs ?? options.defaultTimeoutMs ?? 60_000,
      });

      try {
        const result = await sandbox.execute(code);
        const parts: string[] = [];

        // Itens de saída (console.log / text())
        if (result.output.length > 0) {
          const logs = result.output
            .map((item) => (item.type === "text" ? item.text : `[Imagem: ${item.mimeType}]`))
            .join("\n");
          parts.push(`=== Saída do Script ===\n${logs}`);
        }

        // Retorno da função/expressão
        if (result.ok) {
          if (result.value !== undefined) {
            const valStr =
              typeof result.value === "object"
                ? JSON.stringify(result.value, null, 2)
                : String(result.value);
            parts.push(`=== Retorno ===\n${valStr}`);
          }
        } else {
          parts.push(`=== Erro de Execução ===\n[${result.error.kind}] ${result.error.message}`);
          if (result.error.stack) {
            parts.push(result.error.stack);
          }
        }

        // Diffs de arquivos em Staging
        const stagedDiff = (await getDiffTool.execute(
          {},
          { signal: new AbortController().signal }
        )) as string;

        if (stagedDiff && stagedDiff.trim().length > 0) {
          parts.push(
            `\n=== Alterações em Staging (Pendente de Aprovação) ===\n${stagedDiff}\n\n[DICA]: Use a ferramenta 'codemode_apply' para persistir essas alterações no disco.`
          );
        }

        // Métricas de chamadas de ferramentas
        if (result.calls.length > 0) {
          const callSummary = result.calls
            .map((c) => `  - ${c.name}: ${c.status} (${c.durationMs.toFixed(1)}ms)`)
            .join("\n");
          parts.push(`\n=== Chamadas Realizadas ===\n${callSummary}`);
        }

        return {
          content: [{ type: "text", text: parts.join("\n\n") || "Execução concluída sem saída." }],
          isError: !result.ok,
        };
      } finally {
        await sandbox.close();
      }
    }
  );

  // 2. Ferramenta de confirmação: codemode_apply
  server.tool(
    "codemode_apply",
    "Aplica atomicamente no disco real todas as alterações mantidas na área de staging geradas pelo codemode_run.",
    {},
    async () => {
      try {
        const applied = (await applyTool.execute(
          {},
          { signal: new AbortController().signal }
        )) as string[];

        if (applied.length === 0) {
          return {
            content: [{ type: "text", text: "Nenhuma alteração pendente em staging para aplicar." }],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Alterações gravadas com sucesso no disco (${applied.length} arquivo(s)):\n${applied.map((f) => `  - ${f}`).join("\n")}`,
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text", text: `Falha ao aplicar alterações: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // 3. Ferramenta de descarte: codemode_discard
  server.tool(
    "codemode_discard",
    "Descarta todas as alterações mantidas na área de staging sem modificar o disco.",
    {},
    async () => {
      await discardTool.execute({}, { signal: new AbortController().signal });
      return {
        content: [{ type: "text", text: "Área de staging descartada e limpa com sucesso." }],
      };
    }
  );

  return {
    server,
    policy,
    applyStaged: async () =>
      (await applyTool.execute({}, { signal: new AbortController().signal })) as string[],
    discardStaged: async () => {
      await discardTool.execute({}, { signal: new AbortController().signal });
    },
    getStagedDiff: async () =>
      (await getDiffTool.execute({}, { signal: new AbortController().signal })) as string,
  };
}

export async function runServer(): Promise<void> {
  const { server } = createCodemodeMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Inicia no stdio se for o ponto de entrada principal
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  runServer().catch((error) => {
    console.error("Falha fatal no Servidor MCP Codemode:", error);
    process.exit(1);
  });
}
