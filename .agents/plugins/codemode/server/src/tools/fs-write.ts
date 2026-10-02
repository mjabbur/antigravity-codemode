import fs from "node:fs/promises";
import path from "node:path";
import type { CodemodeTool } from "../sandbox/types.ts";
import type { PathPolicy } from "../security/path-policy.ts";

export interface StagedEntry {
  canonicalPath: string;
  relPath: string;
  originalContent: string | null;
  newContent: string;
}

function generateSimpleUnifiedDiff(relPath: string, original: string | null, updated: string): string {
  if (original === updated) return "";
  const oldHeader = original === null ? "--- /dev/null" : `--- a/${relPath.replace(/\\/g, "/")}`;
  const newHeader = `+++ b/${relPath.replace(/\\/g, "/")}`;

  const origLines = original === null ? [] : original.split(/\r?\n/);
  const newLines = updated.split(/\r?\n/);

  let diff = `${oldHeader}\n${newHeader}\n@@ -${original === null ? 0 : 1},${origLines.length} +${updated === "" ? 0 : 1},${newLines.length} @@\n`;

  if (original === null) {
    for (const line of newLines) {
      diff += `+${line}\n`;
    }
  } else {
    // Diff linha a linha simples
    const max = Math.max(origLines.length, newLines.length);
    for (let i = 0; i < max; i++) {
      const o = origLines[i];
      const n = newLines[i];
      if (o === n) {
        if (o !== undefined) diff += ` ${o}\n`;
      } else {
        if (o !== undefined) diff += `-${o}\n`;
        if (n !== undefined) diff += `+${n}\n`;
      }
    }
  }
  return diff;
}

export function createFsWriteTools(policy: PathPolicy): CodemodeTool[] {
  // B6: Chave canônica em minúsculas para evitar duplicatas por caminhos relativos ou maiúsculas
  const stagedMap = new Map<string, StagedEntry>();

  return [
    {
      name: "writeFile",
      description: "Grava conteúdo em um arquivo no staging em memória com chave canônica.",
      async execute(args: unknown) {
        const { path: filePath, content } = (args ?? {}) as {
          path?: string;
          content?: string;
        };

        if (!filePath || typeof filePath !== "string") {
          throw new Error("Parâmetro 'path' é obrigatório e deve ser uma string.");
        }
        if (typeof content !== "string") {
          throw new Error("Parâmetro 'content' é obrigatório e deve ser uma string.");
        }

        const resolved = policy.resolvePath(filePath, "write");
        const canonicalKey = resolved.toLowerCase();
        const relPath = path.relative(policy.workspaceRoot, resolved).replace(/\\/g, "/");

        let originalContent: string | null = null;

        if (stagedMap.has(canonicalKey)) {
          originalContent = stagedMap.get(canonicalKey)!.originalContent;
        } else {
          try {
            originalContent = await fs.readFile(resolved, "utf-8");
          } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === "ENOENT") {
              originalContent = null;
            } else {
              throw err;
            }
          }
        }

        stagedMap.set(canonicalKey, {
          canonicalPath: resolved,
          relPath,
          originalContent,
          newContent: content,
        });

        return { path: relPath, staged: true };
      },
    },
    {
      name: "editFile",
      description: "Edita pontualmente o conteúdo de um arquivo em staging, exigindo correspondência única de oldText e tratando caracteres de substituição com segurança.",
      async execute(args: unknown) {
        const { path: filePath, oldText, newText } = (args ?? {}) as {
          path?: string;
          oldText?: string;
          newText?: string;
        };

        if (!filePath || typeof filePath !== "string") {
          throw new Error("Parâmetro 'path' é obrigatório e deve ser uma string.");
        }
        if (typeof oldText !== "string" || typeof newText !== "string") {
          throw new Error("Parâmetros 'oldText' e 'newText' são obrigatórios e devem ser strings.");
        }
        if (oldText === "") {
          throw new Error("Parâmetro 'oldText' não pode ser uma string vazia.");
        }

        const resolved = policy.resolvePath(filePath, "write");
        const canonicalKey = resolved.toLowerCase();
        const relPath = path.relative(policy.workspaceRoot, resolved).replace(/\\/g, "/");

        let currentContent: string;
        let originalContent: string | null = null;

        if (stagedMap.has(canonicalKey)) {
          const staged = stagedMap.get(canonicalKey)!;
          currentContent = staged.newContent;
          originalContent = staged.originalContent;
        } else {
          try {
            originalContent = await fs.readFile(resolved, "utf-8");
            currentContent = originalContent;
          } catch (err: unknown) {
            const code = (err as { code?: string })?.code;
            if (code === "ENOENT") {
              throw new Error(`Arquivo "${filePath}" não encontrado para edição.`);
            }
            throw err;
          }
        }

        // B7: Validação estrita de ocorrência única sem sobreposição
        const firstIndex = currentContent.indexOf(oldText);
        if (firstIndex === -1) {
          throw new Error(`oldText não encontrado no arquivo "${filePath}".`);
        }
        const lastIndex = currentContent.lastIndexOf(oldText);
        if (firstIndex !== lastIndex) {
          throw new Error(`Múltiplas ocorrências de oldText encontradas no arquivo "${filePath}". Exatamente 1 ocorrência única é exigida.`);
        }

        // B7: Evita interpretação de caracteres especiais ($&, $$, etc) usando função replacer
        const updatedContent = currentContent.replace(oldText, () => newText);

        stagedMap.set(canonicalKey, {
          canonicalPath: resolved,
          relPath,
          originalContent,
          newContent: updatedContent,
        });

        return { path: relPath, staged: true };
      },
    },
    {
      name: "getStagedDiff",
      description: "Gera diff unificado para todos os arquivos em staging.",
      async execute() {
        if (stagedMap.size === 0) return "";
        const diffs: string[] = [];
        for (const entry of stagedMap.values()) {
          const d = generateSimpleUnifiedDiff(entry.relPath, entry.originalContent, entry.newContent);
          if (d) diffs.push(d);
        }
        return diffs.join("\n");
      },
    },
    {
      name: "applyStaged",
      description: "Aplica de forma atômica todas as alterações em staging no disco com rollback e verificação de concorrência.",
      async execute() {
        if (stagedMap.size === 0) return [];

        const backups = new Map<string, string | null>(); // path -> backup file path
        const writtenPaths: string[] = [];
        const entries = Array.from(stagedMap.values());

        try {
          // Fase 1: Validação de concorrência (optimistic check) e gravação em .tmp
          for (const entry of entries) {
            // Revalida pela policy
            policy.resolvePath(entry.relPath, "write");

            // Verifica se o arquivo no disco sofreu alteração externa desde o stage
            let diskContent: string | null = null;
            try {
              diskContent = await fs.readFile(entry.canonicalPath, "utf-8");
            } catch (err: unknown) {
              const code = (err as { code?: string })?.code;
              if (code !== "ENOENT") throw err;
            }

            if (diskContent !== entry.originalContent) {
              throw new Error(`Conflito de concorrência: o arquivo "${entry.relPath}" foi alterado externamente antes do apply.`);
            }

            // Garante pasta pai
            await fs.mkdir(path.dirname(entry.canonicalPath), { recursive: true });

            // Cria backup temporário do original se existia
            if (diskContent !== null) {
              const backupPath = `${entry.canonicalPath}.bak.${Date.now()}.${Math.random()}`;
              await fs.copyFile(entry.canonicalPath, backupPath);
              backups.set(entry.canonicalPath, backupPath);
            } else {
              backups.set(entry.canonicalPath, null);
            }
          }

          // Fase 2: Aplicação das gravações
          for (const entry of entries) {
            const tempWritePath = `${entry.canonicalPath}.tmp.${Date.now()}.${Math.random()}`;
            await fs.writeFile(tempWritePath, entry.newContent, "utf-8");

            // No Windows, rename sobre arquivo existente pode requerer remoção prévia em alguns FS
            try {
              await fs.rename(tempWritePath, entry.canonicalPath);
            } catch {
              // Retry com unlink
              try {
                await fs.unlink(entry.canonicalPath);
              } catch {}
              await fs.rename(tempWritePath, entry.canonicalPath);
            }

            writtenPaths.push(entry.relPath);
          }

          // Sucesso: remove arquivos de backup
          for (const [, bak] of backups.entries()) {
            if (bak) {
              try {
                await fs.unlink(bak);
              } catch {}
            }
          }

          stagedMap.clear();
          return writtenPaths;
        } catch (err: unknown) {
          // Rollback atômico em caso de falha
          for (const [targetPath, bak] of backups.entries()) {
            if (bak) {
              try {
                await fs.copyFile(bak, targetPath);
                await fs.unlink(bak);
              } catch {}
            } else {
              // Era arquivo novo, remove o que foi criado
              try {
                await fs.unlink(targetPath);
              } catch {}
            }
          }
          throw new Error(`Falha ao aplicar alterações no disco (rollback executado): ${(err as Error).message}`);
        }
      },
    },
    {
      name: "discardStaged",
      description: "Descarta todas as alterações pendentes em staging.",
      async execute() {
        stagedMap.clear();
        return { discarded: true };
      },
    },
  ];
}
