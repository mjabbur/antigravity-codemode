import path from "node:path";
import fs from "node:fs";

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

const DOS_RESERVED = new Set([
  "CON", "PRN", "AUX", "NUL",
  "CONIN$", "CONOUT$",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "COM¹", "COM²", "COM³",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
  "LPT¹", "LPT²", "LPT³"
]);

export class PathPolicy {
  readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    const resolved = path.resolve(workspaceRoot);
    try {
      this.workspaceRoot = fs.realpathSync(resolved);
    } catch {
      this.workspaceRoot = resolved;
    }
  }

  private isSecretFile(basenameLower: string): boolean {
    const clean = basenameLower.replace(/[. ]+$/, "");
    return (
      clean === ".env" ||
      clean.startsWith(".env.") ||
      clean.startsWith("id_rsa") ||
      clean.startsWith("id_dsa") ||
      clean.startsWith("id_ed25519") ||
      clean.startsWith("id_ecdsa") ||
      clean.endsWith(".pem") ||
      clean.endsWith(".key") ||
      clean.endsWith(".pfx") ||
      clean.endsWith(".p12") ||
      clean.endsWith(".ppk") ||
      clean.endsWith(".jks") ||
      clean.endsWith(".keystore") ||
      clean.endsWith(".kdbx") ||
      clean === ".npmrc" ||
      clean === ".netrc" ||
      clean === ".pgpass" ||
      clean === ".htpasswd" ||
      clean === "credentials"
    );
  }

  resolvePath(targetPath: string, mode: "read" | "write" = "read"): string {
    if (typeof targetPath !== "string" || targetPath.trim() === "") {
      throw new SecurityError(`Caminho inválido: "${targetPath}"`);
    }

    // 1. Bloqueia caminhos UNC (\\ ou // ou variações)
    if (/^[/\\]{2}/.test(targetPath)) {
      throw new SecurityError(`Acesso negado: caminhos UNC não são permitidos ("${targetPath}").`);
    }

    // 2. Bloqueia prefixos de namespace de dispositivo Win32 (\\?\, \??\, //?/)
    if (/^[/\\]{2,}[.?][/\\]/.test(targetPath)) {
      throw new SecurityError(`Acesso negado: prefixos de namespace Win32 não são permitidos ("${targetPath}").`);
    }

    // 3. Bloqueia Alternate Data Streams (contendo `:` após o drive letter)
    const withoutDrive = /^[a-zA-Z]:/.test(targetPath) ? targetPath.slice(2) : targetPath;
    if (withoutDrive.includes(":")) {
      throw new SecurityError(`Acesso negado: Alternate Data Streams não são permitidos ("${targetPath}").`);
    }

    // Bloqueia caracteres de controle / proibidos em caminhos
    if (/[\x00<>"|?*]/.test(withoutDrive)) {
      throw new SecurityError(`Acesso negado: caracteres proibidos no caminho ("${targetPath}").`);
    }

    // 4. Checagem por segmentos (nomes DOS reservados, trailing dots/spaces, 8.3)
    const rawSegments = targetPath.split(/[/\\]/);
    for (const segment of rawSegments) {
      if (!segment) continue;

      // Bloqueia trailing dots e spaces que o Win32 normaliza silenciosamente
      if (/[. ]+$/.test(segment) && segment !== "." && segment !== "..") {
        throw new SecurityError(`Acesso negado: trailing dots ou espaços não são permitidos no segmento ("${segment}").`);
      }

      // Bloqueia diretórios sensíveis (.git, .aws, .ssh) em leitura e escrita
      const segLower = segment.toLowerCase();
      if (segLower === ".git" || segLower === ".aws" || segLower === ".ssh") {
        throw new SecurityError(`Acesso negado: acesso ao diretório sensível "${segment}" não é permitido ("${targetPath}").`);
      }

      // Nomes curtos 8.3 contendo ~ seguido de dígitos
      if (/~\d+/.test(segment)) {
        throw new SecurityError(`Acesso negado: nomes curtos 8.3 não são permitidos ("${segment}").`);
      }

      // Validação DOS Reserved: prefixo antes do primeiro ponto
      const primaryName = segment.replace(/[. ]+$/, "").split(".")[0].trim().toUpperCase();
      if (DOS_RESERVED.has(primaryName)) {
        throw new SecurityError(`Acesso negado: nome reservado do MS-DOS ("${segment}").`);
      }
    }

    // 5. Pré-validação de arquivos sensíveis na entrada
    const inputBasename = path.basename(targetPath).toLowerCase();
    if (this.isSecretFile(inputBasename)) {
      throw new SecurityError(`Acesso negado: arquivo sensível ou segredo ("${targetPath}").`);
    }

    // 6. Resolução canônica com resolução de ancestrais (B1)
    const lexicalTarget = path.resolve(this.workspaceRoot, targetPath);
    let canonical = lexicalTarget;

    try {
      if (fs.existsSync(lexicalTarget)) {
        canonical = fs.realpathSync(lexicalTarget);
      } else {
        // Para arquivos novos, encontra o ancestral existente mais próximo e resolve seu realpath
        let cur = path.dirname(lexicalTarget);
        const tailSegments: string[] = [path.basename(lexicalTarget)];
        let foundAncestor = false;

        while (cur.length >= this.workspaceRoot.length) {
          if (fs.existsSync(cur)) {
            const canonicalAncestor = fs.realpathSync(cur);
            canonical = path.join(canonicalAncestor, ...tailSegments);
            foundAncestor = true;
            break;
          }
          tailSegments.unshift(path.basename(cur));
          const parent = path.dirname(cur);
          if (parent === cur) break;
          cur = parent;
        }

        if (!foundAncestor) {
          canonical = lexicalTarget;
        }
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== "ENOENT") {
        throw new SecurityError(`Falha na canonicalização do caminho: ${(err as Error).message}`);
      }
    }

    // 7. Verificação de contenção no workspace (relativo estrito)
    const rel = path.relative(this.workspaceRoot.toLowerCase(), canonical.toLowerCase());
    if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
      throw new SecurityError(`Acesso negado: o caminho "${targetPath}" está fora do workspace.`);
    }

    // 8. Re-validação de segurança pós-resolução sobre o caminho canônico (B2 & B3)
    const canonSegments = rel.split(/[/\\]/).map((s) => s.toLowerCase());
    if (canonSegments.some((s) => s === ".git" || s === ".aws" || s === ".ssh")) {
      throw new SecurityError(`Acesso negado: acesso ao diretório sensível (.git/.aws/.ssh) não é permitido ("${targetPath}").`);
    }

    const canonBasename = path.basename(canonical).toLowerCase();
    if (this.isSecretFile(canonBasename)) {
      throw new SecurityError(`Acesso negado: o caminho canônico aponta para arquivo sensível ("${targetPath}").`);
    }

    return canonical;
  }
}
