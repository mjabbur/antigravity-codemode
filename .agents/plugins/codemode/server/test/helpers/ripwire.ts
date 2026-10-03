import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveBinaryPath } from "../../src/tools/ripwire.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Só aplica o fallback do executável local Windows quando estiver de fato rodando no Windows
if (process.platform === "win32" && !process.env.RIPWIRE_PATH) {
  const localWinBin = path.resolve(__dirname, "../../../../../../bin/ripwire-0.6.5-windows-x64/ripwire.exe");
  if (fs.existsSync(localWinBin)) {
    process.env.RIPWIRE_PATH = localWinBin;
  }
}

export function isRipwireAvailable(): boolean {
  return Boolean(resolveBinaryPath());
}
