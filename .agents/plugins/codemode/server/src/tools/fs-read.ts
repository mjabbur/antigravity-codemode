import fs from "node:fs/promises";
import path from "node:path";
import type { CodemodeTool } from "../sandbox/types.ts";
import { type PathPolicy, SecurityError } from "../security/path-policy.ts";
import { matchRegexWithTimeout, RegexTimeoutError } from "./regex-matcher.ts";

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let regexStr = "";
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i];
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        i += 2;
        if (normalized[i] === "/") {
          i++;
          regexStr += "(?:.*/)?";
        } else {
          regexStr += ".*";
        }
      } else {
        i++;
        regexStr += "[^/]*";
      }
    } else if (c === "?") {
      i++;
      regexStr += "[^/]";
    } else if (".+^$()[]{}\\|".includes(c)) {
      i++;
      regexStr += "\\" + c;
    } else {
      i++;
      regexStr += c;
    }
  }
  return new RegExp(`^${regexStr}$`, "i");
}

async function walkDir(
  dir: string,
  baseDir: string,
  policy: PathPolicy,
  ignoreList: string[] = [],
  results: string[] = []
): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const name = entry.name;
    const nameLower = name.toLowerCase();
    if (nameLower === ".git" || nameLower === "node_modules" || ignoreList.includes(name)) {
      continue;
    }

    const fullPath = path.join(dir, name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");

    // Valida cada arquivo e diretório pela PathPolicy (B8)
    try {
      policy.resolvePath(relPath, "read");
    } catch {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDir(fullPath, baseDir, policy, ignoreList, results);
    } else if (entry.isFile()) {
      results.push(relPath);
    }
  }
  return results;
}

export function createFsReadTools(policy: PathPolicy): CodemodeTool[] {
  return [
    {
      name: "readFile",
      description: "Lê o conteúdo de um arquivo com suporte a offset e limit seguro.",
      async execute(args: unknown) {
        const { path: filePath, offset = 0, limit = 512 * 1024, encoding = "utf-8" } = (args ?? {}) as {
          path?: string;
          offset?: number;
          limit?: number;
          encoding?: string;
        };

        if (!filePath || typeof filePath !== "string") {
          throw new Error("Parâmetro 'path' é obrigatório e deve ser uma string.");
        }
        if (!Number.isSafeInteger(offset) || offset < 0) {
          throw new Error("Parâmetro 'offset' deve ser um inteiro positivo ou zero.");
        }
        if (!Number.isSafeInteger(limit) || limit < 1) {
          throw new Error("Parâmetro 'limit' deve ser um inteiro positivo maior que zero.");
        }

        const resolved = policy.resolvePath(filePath, "read");
        const preStat = await fs.stat(resolved, { bigint: true });
        const maxLimit = 5 * 1024 * 1024; // 5 MB teto
        const effectiveLimit = Math.min(limit, maxLimit);

        // Leitura parcial via fs.open para não carregar arquivos gigantescos na memória
        const handle = await fs.open(resolved, "r");
        try {
          const handleStat = await handle.stat({ bigint: true });
          // Verificação de identidade do handle contra TOCTOU com precisão BigInt de 64 bits
          if (handleStat.dev !== preStat.dev || handleStat.ino !== preStat.ino) {
            throw new SecurityError("Violação de segurança (TOCTOU detectado): identidade do arquivo alterada durante abertura.");
          }
          if (handleStat.isDirectory()) {
            throw new Error(`O caminho "${filePath}" é um diretório, não um arquivo.`);
          }

          const limitBig = BigInt(effectiveLimit);
          const allocBig = limitBig < handleStat.size ? limitBig : handleStat.size;
          const allocSize = Number(allocBig);
          const buf = Buffer.alloc(allocSize);
          const { bytesRead } = await handle.read(buf, 0, allocSize, offset);
          const sliced = buf.subarray(0, bytesRead);

          return encoding === "base64" ? sliced.toString("base64") : sliced.toString("utf-8");
        } finally {
          await handle.close();
        }
      },
    },
    {
      name: "glob",
      description: "Busca recursiva de arquivos respeitando padrão glob e política de segurança.",
      async execute(args: unknown) {
        const { pattern, cwd, ignore = [] } = (args ?? {}) as {
          pattern?: string;
          cwd?: string;
          ignore?: string[];
        };

        if (!pattern || typeof pattern !== "string") {
          throw new Error("Parâmetro 'pattern' é obrigatório e deve ser uma string.");
        }

        const searchDir = cwd ? policy.resolvePath(cwd, "read") : policy.workspaceRoot;
        const allFiles = await walkDir(searchDir, policy.workspaceRoot, policy, ignore);
        const regex = globToRegExp(pattern);

        const matched = allFiles.filter((file) => regex.test(file));
        return matched.sort();
      },
    },
    {
      name: "grep",
      description: "Busca de ocorrências de texto ou regex em arquivos do workspace com filtro de segurança.",
      async execute(args: unknown) {
        const { query, path: searchPath, isRegex = false, caseSensitive = true } = (args ?? {}) as {
          query?: string;
          path?: string;
          isRegex?: boolean;
          caseSensitive?: boolean;
        };

        if (!query || typeof query !== "string") {
          throw new Error("Parâmetro 'query' é obrigatório e deve ser uma string.");
        }
        if (query.length > 200) {
          throw new Error("Tamanho da query excede o limite máximo permitido de 200 caracteres.");
        }

        const target = searchPath ? policy.resolvePath(searchPath, "read") : policy.workspaceRoot;
        const stat = await fs.stat(target);
        let targetFiles: string[] = [];

        if (stat.isFile()) {
          const rel = path.relative(policy.workspaceRoot, target).replace(/\\/g, "/");
          targetFiles = [rel];
        } else {
          targetFiles = await walkDir(target, policy.workspaceRoot, policy, []);
          targetFiles.sort();
        }

        if (isRegex) {
          try {
            new RegExp(query, caseSensitive ? "" : "i");
          } catch (err: unknown) {
            throw new Error(`Expressão regular inválida: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        const results: Array<{ file: string; line: number; text: string }> = [];
        const limit = 500;
        const queryLower = caseSensitive ? query : query.toLowerCase();
        const grepDeadline = Date.now() + 15_000; // Teto global de 15s para toda a busca

        for (const fileRel of targetFiles) {
          if (results.length >= limit) break;
          if (Date.now() > grepDeadline) {
            throw new Error("Tempo limite global da busca grep excedido (15s).");
          }

          const fullPath = path.resolve(policy.workspaceRoot, fileRel);

          try {
            const preStat = await fs.stat(fullPath, { bigint: true });
            const handle = await fs.open(fullPath, "r");
            let content = "";
            try {
              const handleStat = await handle.stat({ bigint: true });
              // Verificação de identidade do handle contra TOCTOU com precisão BigInt de 64 bits
              if (handleStat.dev !== preStat.dev || handleStat.ino !== preStat.ino) {
                throw new SecurityError("Violação de segurança (TOCTOU detectado): identidade do arquivo alterada durante abertura.");
              }

              // Pula arquivos maiores que 10MB
              if (handleStat.size > 10n * 1024n * 1024n) continue;

              // Detecção de arquivo binário no primeiro bloco (512 bytes)
              const probeSize = Number(handleStat.size > 512n ? 512n : handleStat.size);
              const probe = Buffer.alloc(probeSize);
              const { bytesRead } = await handle.read(probe, 0, probe.length, 0);
              if (probe.subarray(0, bytesRead).includes(0)) continue;

              // Lê diretamente do handle já aberto com teto de tamanho (evita TOCTOU e releitura)
              content = await handle.readFile({ encoding: "utf-8" });
            } finally {
              await handle.close();
            }

            const lines = content.split(/\r?\n/);
            if (isRegex) {
              const matchedIndices = await matchRegexWithTimeout(
                query,
                caseSensitive ? "" : "i",
                lines
              );
              for (const idx of matchedIndices) {
                if (results.length >= limit) break;
                const lineText = lines[idx];
                results.push({
                  file: fileRel,
                  line: idx + 1,
                  text: lineText.length > 300 ? `${lineText.slice(0, 297)}...` : lineText,
                });
              }
            } else {
              for (let idx = 0; idx < lines.length; idx++) {
                if (results.length >= limit) break;
                const lineText = lines[idx];
                const lineSearch = caseSensitive ? lineText : lineText.toLowerCase();
                if (lineSearch.includes(queryLower)) {
                  results.push({
                    file: fileRel,
                    line: idx + 1,
                    text: lineText.length > 300 ? `${lineText.slice(0, 297)}...` : lineText,
                  });
                }
              }
            }
          } catch (err: unknown) {
            if (err instanceof SecurityError) throw err;
            if (err instanceof RegexTimeoutError) {
              if (targetFiles.length === 1) throw err;
              continue;
            }
            // Ignora arquivos inacessíveis
          }
        }

        return results;
      },
    },
  ];
}
