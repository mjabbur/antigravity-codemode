import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { PathPolicy, SecurityError } from "../src/security/path-policy.ts";
import { createFsReadTools } from "../src/tools/fs-read.ts";
import { createFsWriteTools } from "../src/tools/fs-write.ts";
import { CodemodeSandbox } from "../src/sandbox/index.ts";

describe("Segurança de Caminhos no Windows e Filesystem com Staging (Spec 02 Refinada)", () => {
  let tempDir: string;
  let policy: PathPolicy;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "codemode-test-"));
    // Cria arquivos de teste
    await fs.writeFile(path.join(tempDir, "sample.txt"), "conteudo inicial de teste\nlinha dois\n");
    await fs.writeFile(path.join(tempDir, ".env"), "SECRET_API_KEY=12345\n");
    await fs.mkdir(path.join(tempDir, "sub"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "sub", "nested.txt"), "arquivo aninhado\n");
    policy = new PathPolicy(tempDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignora erro de limpeza no Windows
    }
  });

  it("S01: Bloqueia tentativa de Path Traversal (../../)", () => {
    expect(() => policy.resolvePath("../../windows/win.ini")).toThrow(SecurityError);
    expect(() => policy.resolvePath("../other")).toThrow(SecurityError);
  });

  it("S02: Bloqueia caminhos UNC (\\\\server\\share e //server/share)", () => {
    expect(() => policy.resolvePath("\\\\192.168.1.10\\share\\passwords.txt")).toThrow(SecurityError);
    expect(() => policy.resolvePath("//192.168.1.10/share/passwords.txt")).toThrow(SecurityError);
  });

  it("S03: Bloqueia nomes reservados do MS-DOS (CON, NUL, AUX, con.tar.gz)", () => {
    const winPolicy = new PathPolicy(tempDir, { isWindows: true, caseInsensitive: true });
    expect(() => winPolicy.resolvePath("CON.txt")).toThrow(SecurityError);
    expect(() => winPolicy.resolvePath("sub/nul.md")).toThrow(SecurityError);
    expect(() => winPolicy.resolvePath("aux")).toThrow(SecurityError);
    expect(() => winPolicy.resolvePath("com1.json")).toThrow(SecurityError);
    expect(() => winPolicy.resolvePath("con.tar.gz")).toThrow(SecurityError);
  });

  it("S04: Bloqueia Alternate Data Streams (ADS) e caracteres proibidos", () => {
    const winPolicy = new PathPolicy(tempDir, { isWindows: true, caseInsensitive: true });
    expect(() => winPolicy.resolvePath("sample.txt:hidden")).toThrow(SecurityError);
    expect(() => winPolicy.resolvePath("sample.txt\0")).toThrow(SecurityError);
  });

  it("S05: Bloqueia trailing dots e spaces que o Win32 normaliza", () => {
    const winPolicy = new PathPolicy(tempDir, { isWindows: true, caseInsensitive: true });
    expect(() => winPolicy.resolvePath("sample.txt.")).toThrow(SecurityError);
    expect(() => winPolicy.resolvePath("sample.txt ")).toThrow(SecurityError);
  });

  it("S06: Bloqueia acesso a arquivos de segredos (.env*, *.pem, *.key, .git write)", () => {
    expect(() => policy.resolvePath(".env")).toThrow(SecurityError);
    expect(() => policy.resolvePath(".env.production")).toThrow(SecurityError);
    expect(() => policy.resolvePath("cert.pem")).toThrow(SecurityError);
    expect(() => policy.resolvePath("id_rsa")).toThrow(SecurityError);
    expect(() => policy.resolvePath(".git/config", "write")).toThrow(SecurityError);
    expect(() => policy.resolvePath(".GIT/hooks/pre-commit", "write")).toThrow(SecurityError);
  });

  it("S07: Leitura normal e parcial com readFile validando offset e limit", async () => {
    const readTools = createFsReadTools(policy);
    const readFileTool = readTools.find((t) => t.name === "readFile")!;

    // Leitura completa
    const content = await readFileTool.execute({ path: "sample.txt" }, { signal: new AbortController().signal });
    expect(content).toBe("conteudo inicial de teste\nlinha dois\n");

    // Leitura parcial com offset
    const partial = await readFileTool.execute({ path: "sample.txt", offset: 9, limit: 7 }, { signal: new AbortController().signal });
    expect(partial).toBe("inicial");

    // Validação de limites inválidos
    await expect(readFileTool.execute({ path: "sample.txt", offset: -1 })).rejects.toThrow();
    await expect(readFileTool.execute({ path: "sample.txt", limit: 0 })).rejects.toThrow();
  });

  it("S08: Busca com glob e grep filtrando segredos (.env não deve vazar)", async () => {
    const readTools = createFsReadTools(policy);
    const globTool = readTools.find((t) => t.name === "glob")!;
    const grepTool = readTools.find((t) => t.name === "grep")!;

    // Glob não deve incluir .env
    const files = (await globTool.execute({ pattern: "**/*" }, { signal: new AbortController().signal })) as string[];
    expect(files).toContain("sample.txt");
    expect(files).toContain("sub/nested.txt");
    expect(files).not.toContain(".env");

    // Grep buscando SECRET_API_KEY não deve encontrar nada porque .env é ignorado pela policy
    const matches = (await grepTool.execute({ query: "SECRET_API_KEY" }, { signal: new AbortController().signal })) as Array<unknown>;
    expect(matches).toHaveLength(0);

    // Grep em arquivo único válido
    const singleMatch = (await grepTool.execute({ query: "aninhado", path: "sub/nested.txt" }, { signal: new AbortController().signal })) as Array<{ file: string }>;
    expect(singleMatch).toHaveLength(1);
    expect(singleMatch[0].file).toBe("sub/nested.txt");
  });

  it("S09: Staging de escrita com chave canônica previne duplicações", async () => {
    const writeTools = createFsWriteTools(policy);
    const writeFileTool = writeTools.find((t) => t.name === "writeFile")!;
    const getDiffTool = writeTools.find((t) => t.name === "getStagedDiff")!;

    // Grava como "novo.txt" e depois sobrescreve via "./novo.txt"
    await writeFileTool.execute({ path: "novo.txt", content: "primeiro" }, { signal: new AbortController().signal });
    await writeFileTool.execute({ path: "./novo.txt", content: "segundo" }, { signal: new AbortController().signal });

    const diff = (await getDiffTool.execute({}, { signal: new AbortController().signal })) as string;
    // Não deve conter dois arquivos no diff
    const countOccurrences = (diff.match(/\+\+\+ b\/novo\.txt/g) || []).length;
    expect(countOccurrences).toBe(1);
    expect(diff).toContain("+segundo");
  });

  it("S10: editFile trata caracteres especiais ($&, $$) sem corromper texto", async () => {
    const writeTools = createFsWriteTools(policy);
    const editFileTool = writeTools.find((t) => t.name === "editFile")!;
    const getDiffTool = writeTools.find((t) => t.name === "getStagedDiff")!;

    // Substituição contendo $& e $$
    await editFileTool.execute({
      path: "sample.txt",
      oldText: "linha dois",
      newText: "custo total: $& e $$100",
    }, { signal: new AbortController().signal });

    const diff = (await getDiffTool.execute({}, { signal: new AbortController().signal })) as string;
    expect(diff).toContain("+custo total: $& e $$100");
  });

  it("S11: editFile valida oldText vazio ou inexistente", async () => {
    const writeTools = createFsWriteTools(policy);
    const editFileTool = writeTools.find((t) => t.name === "editFile")!;

    await expect(
      editFileTool.execute({ path: "sample.txt", oldText: "", newText: "abc" }, { signal: new AbortController().signal })
    ).rejects.toThrow(/não pode ser uma string vazia/);

    await expect(
      editFileTool.execute({ path: "sample.txt", oldText: "texto inexistente", newText: "abc" }, { signal: new AbortController().signal })
    ).rejects.toThrow(/não encontrado/);
  });

  it("S12: applyStaged aplica alterações atomicamente no disco", async () => {
    const writeTools = createFsWriteTools(policy);
    const writeFileTool = writeTools.find((t) => t.name === "writeFile")!;
    const applyTool = writeTools.find((t) => t.name === "applyStaged")!;

    await writeFileTool.execute({ path: "aplicado.txt", content: "salvo com sucesso" }, { signal: new AbortController().signal });
    const applied = (await applyTool.execute({}, { signal: new AbortController().signal })) as string[];

    expect(applied).toContain("aplicado.txt");

    const onDisk = await fs.readFile(path.join(tempDir, "aplicado.txt"), "utf-8");
    expect(onDisk).toBe("salvo com sucesso");
  });

  it("S13: applyStaged detecta alteração concorrente (stale) e aborta", async () => {
    const writeTools = createFsWriteTools(policy);
    const editFileTool = writeTools.find((t) => t.name === "editFile")!;
    const applyTool = writeTools.find((t) => t.name === "applyStaged")!;

    // Stage de edição
    await editFileTool.execute({ path: "sample.txt", oldText: "linha dois", newText: "alterado em stage" }, { signal: new AbortController().signal });

    // Modifica o arquivo no disco externamente ANTES do apply
    await fs.writeFile(path.join(tempDir, "sample.txt"), "modificado por outro processo\n");

    // O apply deve falhar por conflito de concorrência
    await expect(applyTool.execute({}, { signal: new AbortController().signal })).rejects.toThrow(/Conflito de concorrência/);
  });

  it("S14: Bloqueia leitura e escrita no diretório .git e .GIT (.git/config e variações)", () => {
    expect(() => policy.resolvePath(".git/config", "read")).toThrow(SecurityError);
    expect(() => policy.resolvePath(".GIT/config", "read")).toThrow(SecurityError);
    expect(() => policy.resolvePath(".git/HEAD", "write")).toThrow(SecurityError);
    expect(() => policy.resolvePath("sub/.git/config", "read")).toThrow(SecurityError);
    // Mas permite .gitignore e .gitattributes
    expect(policy.resolvePath(".gitignore", "read")).toBeDefined();
    expect(policy.resolvePath(".gitattributes", "read")).toBeDefined();
  });

  it("S15: Bloqueia junction/symlink escapando do workspace e arquivo novo sob junction", async (ctx) => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "codemode-outside-"));
    try {
      await fs.writeFile(path.join(outsideDir, "secret.txt"), "outside secret");
      const junctionPath = path.join(tempDir, "link-outside");
      try {
        await fs.symlink(outsideDir, junctionPath, "junction");
      } catch {
        ctx.skip();
        return;
      }

      // Leitura de arquivo existente apontando para fora via junction
      expect(() => policy.resolvePath("link-outside/secret.txt", "read")).toThrow(SecurityError);

      // Escrita de novo arquivo apontando para fora via junction
      expect(() => policy.resolvePath("link-outside/novo-fora.txt", "write")).toThrow(SecurityError);
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("S16: editFile rejeita múltiplas ocorrências de oldText e preserva literal $1", async () => {
    const writeTools = createFsWriteTools(policy);
    const writeFileTool = writeTools.find((t) => t.name === "writeFile")!;
    const editFileTool = writeTools.find((t) => t.name === "editFile")!;

    await writeFileTool.execute({
      path: "repetido.txt",
      content: "banana maca banana pera",
    }, { signal: new AbortController().signal });

    // Múltiplas ocorrências de 'banana'
    await expect(
      editFileTool.execute({
        path: "repetido.txt",
        oldText: "banana",
        newText: "uva",
      }, { signal: new AbortController().signal })
    ).rejects.toThrow(/Múltiplas ocorrências/);

    // Substituição preservando literal $1
    await editFileTool.execute({
      path: "sample.txt",
      oldText: "linha dois",
      newText: "preco: $1 por unidade",
    }, { signal: new AbortController().signal });

    const diffTool = writeTools.find((t) => t.name === "getStagedDiff")!;
    const diff = (await diffTool.execute({}, { signal: new AbortController().signal })) as string;
    expect(diff).toContain("+preco: $1 por unidade");
  });

  it("S17: Staging unifica chaves com caixa diferente (A.txt vs a.txt)", async () => {
    const winPolicy = new PathPolicy(tempDir, { isWindows: true, caseInsensitive: true });
    const writeTools = createFsWriteTools(winPolicy, { caseInsensitive: true });
    const writeFileTool = writeTools.find((t) => t.name === "writeFile")!;
    const getDiffTool = writeTools.find((t) => t.name === "getStagedDiff")!;

    await writeFileTool.execute({ path: "Documento.txt", content: "primeira versao" }, { signal: new AbortController().signal });
    await writeFileTool.execute({ path: "documento.txt", content: "segunda versao" }, { signal: new AbortController().signal });

    const diff = (await getDiffTool.execute({}, { signal: new AbortController().signal })) as string;
    const matchCount = (diff.match(/\+\+\+ b\/Documento\.txt/gi) || []).length;
    expect(matchCount).toBe(1);
    expect(diff).toContain("+segunda versao");
  });

  it("S18: applyStaged executa rollback completo caso ocorra erro durante a aplicação", async () => {
    const writeTools = createFsWriteTools(policy);
    const editFileTool = writeTools.find((t) => t.name === "editFile")!;
    const writeFileTool = writeTools.find((t) => t.name === "writeFile")!;
    const applyTool = writeTools.find((t) => t.name === "applyStaged")!;

    // 1. Modifica sample.txt em staging
    await editFileTool.execute({
      path: "sample.txt",
      oldText: "linha dois",
      newText: "linha dois alterada",
    }, { signal: new AbortController().signal });

    // 2. Cria um arquivo 'bloqueio' no disco para impedir que 'bloqueio/arquivo.txt' seja criado como pasta
    await fs.writeFile(path.join(tempDir, "bloqueio"), "sou um arquivo, nao uma pasta");

    // 3. Adiciona ao staging um caminho que causará erro de I/O no mkdir
    await writeFileTool.execute({
      path: "bloqueio/sub.txt",
      content: "deve falhar",
    }, { signal: new AbortController().signal });

    // O apply deve falhar e fazer rollback
    await expect(applyTool.execute({}, { signal: new AbortController().signal })).rejects.toThrow(/Falha ao aplicar alterações no disco/);

    // O arquivo sample.txt original DEVE permanecer intacto no disco (rollback efetuado)
    const onDisk = await fs.readFile(path.join(tempDir, "sample.txt"), "utf-8");
    expect(onDisk).toBe("conteudo inicial de teste\nlinha dois\n");
  });

  it("S19: ReDoS mitigado por Worker com timeout para quantificadores aninhados, alternâncias e grupos complexos", async () => {
    const readTools = createFsReadTools(policy);
    const grepTool = readTools.find((t) => t.name === "grep")!;

    // Cria um arquivo com string que dispara backtracking exponencial
    await fs.writeFile(path.join(tempDir, "redos.txt"), "a".repeat(35) + "X\n");

    // 1. Grupos aninhados ((a+))+$
    await expect(
      grepTool.execute({ query: "((a+))+$", path: "redos.txt", isRegex: true }, { signal: new AbortController().signal })
    ).rejects.toThrow(/ReDoS detectado/);

    // 2. Não-capturante aninhado (?:(a+))+$
    await expect(
      grepTool.execute({ query: "(?:(a+))+$", path: "redos.txt", isRegex: true }, { signal: new AbortController().signal })
    ).rejects.toThrow(/ReDoS detectado/);

    // 3. Alternância sobreposta (a|aa)+$
    await expect(
      grepTool.execute({ query: "(a|aa)+$", path: "redos.txt", isRegex: true }, { signal: new AbortController().signal })
    ).rejects.toThrow(/ReDoS detectado/);
  }, 10000);

  it("S20: grep em modo texto exato (isRegex: false) não trunca linhas longas", async () => {
    const readTools = createFsReadTools(policy);
    const grepTool = readTools.find((t) => t.name === "grep")!;

    // Cria uma linha com mais de 3000 caracteres onde o alvo está no final
    const longLine = "x".repeat(2500) + "PALAVRA_CHAVE_NO_FINAL";
    await fs.writeFile(path.join(tempDir, "long.txt"), longLine + "\n");

    const matches = (await grepTool.execute({
      query: "PALAVRA_CHAVE_NO_FINAL",
      path: "long.txt",
      isRegex: false,
    }, { signal: new AbortController().signal })) as Array<{ file: string; line: number }>;

    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe("long.txt");
  });

  it("S21: Regex legítimas funcionam sem falsos positivos ((a|b)+, (foo|bar)*, a+?)", async () => {
    const readTools = createFsReadTools(policy);
    const grepTool = readTools.find((t) => t.name === "grep")!;

    await fs.writeFile(path.join(tempDir, "legit.txt"), "abba bar aaaa\n");

    // Alternância segura
    const r1 = (await grepTool.execute({ query: "(a|b)+", path: "legit.txt", isRegex: true }, { signal: new AbortController().signal })) as Array<{ file: string }>;
    expect(r1.length).toBeGreaterThan(0);

    // Alternância de palavras
    const r2 = (await grepTool.execute({ query: "(foo|bar)*", path: "legit.txt", isRegex: true }, { signal: new AbortController().signal })) as Array<{ file: string }>;
    expect(r2.length).toBeGreaterThan(0);

    // Quantificador preguiçoso
    const r3 = (await grepTool.execute({ query: "a+?", path: "legit.txt", isRegex: true }, { signal: new AbortController().signal })) as Array<{ file: string }>;
    expect(r3.length).toBeGreaterThan(0);
  });

  it("S22: TOCTOU detectado e rejeitado quando identidade do arquivo (ino/dev) diverge entre stat e open", async () => {
    const readTools = createFsReadTools(policy);
    const readFileTool = readTools.find((t) => t.name === "readFile")!;
    const grepTool = readTools.find((t) => t.name === "grep")!;

    const victim = path.join(tempDir, "toctou.txt");
    await fs.writeFile(victim, "conteudo original");

    // Espiona fs.stat para simular que stat obteve dev/ino diferente do handle aberto
    const originalStat = fs.stat;
    const statSpy = vi.spyOn(fs, "stat").mockImplementation(async (targetPath, opts) => {
      const real = await originalStat(targetPath, opts as any);
      if (String(targetPath).includes("toctou.txt") && (opts as any)?.bigint) {
        return { ...real, ino: (real.ino as bigint) + 999999n } as any;
      }
      return real;
    });

    try {
      // 1. Teste em readFile
      await expect(
        readFileTool.execute({ path: "toctou.txt" }, { signal: new AbortController().signal })
      ).rejects.toThrow(/TOCTOU detectado/);

      // 2. Teste em grep
      await expect(
        grepTool.execute({ query: "conteudo", path: "toctou.txt" }, { signal: new AbortController().signal })
      ).rejects.toThrow(/TOCTOU detectado/);
    } finally {
      statSpy.mockRestore();
    }
  });

  it("S23: PathPolicy com caseInsensitive: false bloqueia pasta irmã fora do workspace que difere por caixa (A1)", async () => {
    if (process.platform === "win32") {
      const ws = path.join(tempDir, "Project");
      await fs.mkdir(ws);
      const csPolicy = new PathPolicy(ws, { caseInsensitive: false, isWindows: false });
      const outside = path.join(tempDir, "project", "secret.txt");
      expect(() => csPolicy.resolvePath(outside, "read")).toThrow(SecurityError);
    } else {
      const parent = await fs.mkdtemp(path.join(os.tmpdir(), "case-test-"));
      const ws = path.join(parent, "Project");
      const outside = path.join(parent, "project");
      await fs.mkdir(ws);
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, "secret.txt"), "outside secret");

      try {
        const csPolicy = new PathPolicy(ws, { caseInsensitive: false, isWindows: false });
        expect(() => csPolicy.resolvePath(path.join(outside, "secret.txt"), "read")).toThrow(SecurityError);
      } finally {
        await fs.rm(parent, { recursive: true, force: true }).catch(() => {});
      }
    }
  });

  it("S24: createFsWriteTools com caseInsensitive: false mantém chaves distintas para Arquivo.txt e arquivo.txt (A2)", async () => {
    const csPolicy = new PathPolicy(tempDir, { caseInsensitive: false, isWindows: false });
    const writeTools = createFsWriteTools(csPolicy, { caseInsensitive: false });
    const writeFileTool = writeTools.find((t) => t.name === "writeFile")!;
    const getDiffTool = writeTools.find((t) => t.name === "getStagedDiff")!;

    await writeFileTool.execute({ path: "Arquivo.txt", content: "Versao A" }, { signal: new AbortController().signal });
    await writeFileTool.execute({ path: "arquivo.txt", content: "Versao B" }, { signal: new AbortController().signal });

    const diff = (await getDiffTool.execute({}, { signal: new AbortController().signal })) as string;
    expect(diff).toContain("+++ b/Arquivo.txt");
    expect(diff).toContain("+++ b/arquivo.txt");
    expect(diff).toContain("+Versao A");
    expect(diff).toContain("+Versao B");
  });

  it("S25: PathPolicy com isWindows: false permite ':' e nomes reservados DOS tradicionais (B2 e B4)", () => {
    const posixPolicy = new PathPolicy(tempDir, { isWindows: false, caseInsensitive: false });
    // Permite ':' (ex: timestamp de log)
    expect(() => posixPolicy.resolvePath("logs/app-2026-10-03T05:00:00.log", "write")).not.toThrow();
    // Permite nomes reservados MS-DOS como aux.c e con.h
    expect(() => posixPolicy.resolvePath("src/aux.c", "write")).not.toThrow();
    expect(() => posixPolicy.resolvePath("src/con.h", "write")).not.toThrow();
  });

  it("S26: PathPolicy com isWindows: false permite trailing dots e nomes com til (B3 e B5)", () => {
    const posixPolicy = new PathPolicy(tempDir, { isWindows: false, caseInsensitive: false });
    // Permite trailing dots
    expect(() => posixPolicy.resolvePath("src/ellipsis...", "write")).not.toThrow();
    // Permite nomes com til (8.3)
    expect(() => posixPolicy.resolvePath("backup~1.txt", "read")).not.toThrow();
  });

  it("S27: writeFile lida com segmento que colide com arquivo sem lançar ENOTDIR não-tratado (D1)", async () => {
    await fs.writeFile(path.join(tempDir, "arquivo-colisao"), "conteudo");
    const writeTools = createFsWriteTools(policy);
    const writeFileTool = writeTools.find((t) => t.name === "writeFile")!;

    // No Linux real, fs.readFile(".../arquivo-colisao/sub.txt") lança ENOTDIR
    // Agora é tratado como inexistente no staging inicial
    const res = await writeFileTool.execute({
      path: "arquivo-colisao/sub.txt",
      content: "conteudo novo",
    }, { signal: new AbortController().signal });

    expect(res).toBeDefined();
    expect((res as any).staged).toBe(true);
  });

  it("S28: applyStaged preserva permissões originais (st_mode) do arquivo no disco (D2)", async () => {
    const scriptPath = path.join(tempDir, "executavel.sh");
    await fs.writeFile(scriptPath, "#!/bin/sh\necho original\n", { mode: 0o755 });

    const writeTools = createFsWriteTools(policy);
    const editFileTool = writeTools.find((t) => t.name === "editFile")!;
    const applyTool = writeTools.find((t) => t.name === "applyStaged")!;

    await editFileTool.execute({
      path: "executavel.sh",
      oldText: "echo original",
      newText: "echo atualizado",
    }, { signal: new AbortController().signal });

    await applyTool.execute({}, { signal: new AbortController().signal });

    const stat = await fs.stat(scriptPath);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o111).toBe(0o111);
    } else {
      const content = await fs.readFile(scriptPath, "utf-8");
      expect(content).toContain("echo atualizado");
    }
  });
});
