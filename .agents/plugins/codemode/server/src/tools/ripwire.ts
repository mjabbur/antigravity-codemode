import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { CodemodeTool, CodemodeToolContext } from "../sandbox/types.ts";
import type { PathPolicy } from "../security/path-policy.ts";

const execFileAsync = promisify(execFile);

export interface RipwireOptions {
  binaryPath?: string;
  timeoutMs?: number;
  maxBuffer?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

function resolveBinaryPath(customPath?: string): string {
  if (customPath && fs.existsSync(customPath)) {
    return customPath;
  }
  if (process.env.RIPWIRE_PATH && fs.existsSync(process.env.RIPWIRE_PATH)) {
    return process.env.RIPWIRE_PATH;
  }

  // Fallback padrão do ambiente Joker
  const candidate = "c:\\Dev\\Joker\\bin\\ripwire-0.6.5-windows-x64\\ripwire.exe";
  if (fs.existsSync(candidate)) {
    return candidate;
  }

  throw new Error(
    "Binário do Ripwire não encontrado. Defina a variável de ambiente RIPWIRE_PATH ou verifique a instalação."
  );
}

function validateSymbol(symbol: unknown): string {
  if (!symbol || typeof symbol !== "string") {
    throw new Error("Parâmetro 'symbol' é obrigatório e deve ser uma string não vazia.");
  }
  if (/[\r\n\0]/.test(symbol)) {
    throw new Error(`Símbolo inválido: contém caracteres de controle proibidos ("${symbol}").`);
  }
  return symbol.trim();
}

async function executeRipwire(
  binary: string,
  args: string[],
  cwd: string,
  context?: CodemodeToolContext,
  options?: RipwireOptions
): Promise<string> {
  const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER;

  try {
    const { stdout } = await execFileAsync(binary, args, {
      cwd,
      timeout,
      maxBuffer,
      signal: context?.signal,
      windowsHide: true,
    });
    return stdout;
  } catch (err: unknown) {
    const errorObj = err as { code?: string | number; killed?: boolean; stdout?: string; stderr?: string };
    if (errorObj.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
      throw new Error("Limite de buffer de saída do Ripwire excedido (maxBuffer 10MB).");
    }
    if (context?.signal?.aborted || errorObj.killed) {
      throw new Error("Execução do Ripwire cancelada ou atingiu o tempo limite (timeout).");
    }
    // Se ripwire retornar stdout com código 0 ou aviso, checa stdout
    if (errorObj.stdout && errorObj.stdout.trim().length > 0) {
      return errorObj.stdout;
    }
    throw new Error(`Falha na execução do Ripwire: ${errorObj.stderr || (err as Error).message}`);
  }
}

export function createRipwireTools(
  policy: PathPolicy,
  options?: RipwireOptions
): CodemodeTool[] {
  const binary = resolveBinaryPath(options?.binaryPath);

  return [
    {
      name: "map",
      description: "Gera o mapa sintático do repositório/diretório com ranking de Personalized PageRank.",
      async execute(args: unknown, context: CodemodeToolContext) {
        const {
          path: targetPath,
          topK = 100,
          maxTokens,
          json = true,
        } = (args ?? {}) as {
          path?: string;
          topK?: number;
          maxTokens?: number;
          json?: boolean;
        };

        const resolvedDir = targetPath
          ? policy.resolvePath(targetPath, "read")
          : policy.workspaceRoot;

        const cliArgs: string[] = [resolvedDir];
        if (typeof topK === "number" && Number.isSafeInteger(topK) && topK > 0) {
          cliArgs.push(`--top-k=${topK}`);
        }
        if (typeof maxTokens === "number" && Number.isSafeInteger(maxTokens) && maxTokens > 0) {
          cliArgs.push(`--max-tokens=${maxTokens}`);
        }
        if (json) {
          cliArgs.push("--json");
        }

        const raw = await executeRipwire(binary, cliArgs, policy.workspaceRoot, context, options);
        if (json) {
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        }
        return raw;
      },
    },
    {
      name: "for",
      description: "Task Lens: recupera assinaturas e nós de código prioritários para uma tarefa específica.",
      async execute(args: unknown, context: CodemodeToolContext) {
        const { task, path: targetPath, signaturesOnly = false } = (args ?? {}) as {
          task?: string;
          path?: string;
          signaturesOnly?: boolean;
        };

        if (!task || typeof task !== "string" || task.trim() === "") {
          throw new Error("Parâmetro 'task' é obrigatório e deve ser uma descrição em texto da tarefa.");
        }

        const resolvedDir = targetPath
          ? policy.resolvePath(targetPath, "read")
          : policy.workspaceRoot;

        const cliArgs: string[] = [resolvedDir, `--for=${task}`, "--json"];
        if (signaturesOnly) {
          cliArgs.push("--signatures-only");
        }

        const raw = await executeRipwire(binary, cliArgs, policy.workspaceRoot, context, options);
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      },
    },
    {
      name: "callers",
      description: "Localiza os chamadores diretos (in-edges de 1 salto) de um símbolo.",
      async execute(args: unknown, context: CodemodeToolContext) {
        const { symbol, path: targetPath } = (args ?? {}) as {
          symbol?: string;
          path?: string;
        };

        const sym = validateSymbol(symbol);
        const resolvedDir = targetPath
          ? policy.resolvePath(targetPath, "read")
          : policy.workspaceRoot;

        const cliArgs: string[] = [resolvedDir, `--callers=${sym}`, "--json"];
        const raw = await executeRipwire(binary, cliArgs, policy.workspaceRoot, context, options);
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      },
    },
    {
      name: "uses",
      description: "Mostra todos os locais onde o símbolo é lido, gravado, chamado ou importado.",
      async execute(args: unknown, context: CodemodeToolContext) {
        const { symbol, path: targetPath } = (args ?? {}) as {
          symbol?: string;
          path?: string;
        };

        const sym = validateSymbol(symbol);
        const resolvedDir = targetPath
          ? policy.resolvePath(targetPath, "read")
          : policy.workspaceRoot;

        const cliArgs: string[] = [resolvedDir, `--uses=${sym}`, "--json"];
        const raw = await executeRipwire(binary, cliArgs, policy.workspaceRoot, context, options);
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      },
    },
    {
      name: "impact",
      description: "Calcula o blast radius (raio de alcance transitivo e arquivos que importam) de um símbolo.",
      async execute(args: unknown, context: CodemodeToolContext) {
        const { symbol, path: targetPath } = (args ?? {}) as {
          symbol?: string;
          path?: string;
        };

        const sym = validateSymbol(symbol);
        const resolvedDir = targetPath
          ? policy.resolvePath(targetPath, "read")
          : policy.workspaceRoot;

        const cliArgs: string[] = [resolvedDir, `--impact=${sym}`, "--json"];
        const raw = await executeRipwire(binary, cliArgs, policy.workspaceRoot, context, options);
        try {
          return JSON.parse(raw);
        } catch {
          return raw;
        }
      },
    },
    {
      name: "around",
      description: "Gera o ego graph local ao redor de um símbolo com profundidade configurável.",
      async execute(args: unknown, context: CodemodeToolContext) {
        const { symbol, depth = 1, path: targetPath } = (args ?? {}) as {
          symbol?: string;
          depth?: number;
          path?: string;
        };

        const sym = validateSymbol(symbol);
        const resolvedDir = targetPath
          ? policy.resolvePath(targetPath, "read")
          : policy.workspaceRoot;

        const safeDepth = typeof depth === "number" && Number.isSafeInteger(depth)
          ? Math.min(Math.max(1, depth), 5)
          : 1;

        const cliArgs: string[] = [
          resolvedDir,
          `--around=${sym}`,
          `--around-depth=${safeDepth}`,
        ];
        const raw = await executeRipwire(binary, cliArgs, policy.workspaceRoot, context, options);
        return raw;
      },
    },
  ];
}
