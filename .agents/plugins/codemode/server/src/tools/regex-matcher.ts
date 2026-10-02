import { Worker } from "node:worker_threads";

function getWorkerUrl(): URL {
  return new URL(
    import.meta.url.endsWith(".ts") ? "./regex-worker.ts" : "./regex-worker.js",
    import.meta.url
  );
}

export class RegexTimeoutError extends Error {
  constructor(message = "Tempo limite excedido ao processar expressão regular (possível ReDoS detectado).") {
    super(message);
    this.name = "RegexTimeoutError";
  }
}

/**
 * Executa correspondência de RegExp em uma Worker Thread dedicada e isolada com timeout rígido.
 * Em caso de estouro de tempo (ReDoS catastrófico) ou erro inesperado, o worker é terminado
 * via terminate() imediatamente, garantindo isolamento total entre tarefas concorrentes.
 */
export async function matchRegexWithTimeout(
  pattern: string,
  flags: string,
  lines: string[],
  timeoutMs = 600
): Promise<number[]> {
  const worker = new Worker(getWorkerUrl());

  return new Promise<number[]>((resolve, reject) => {
    let timer: NodeJS.Timeout | null = null;
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try {
        worker.terminate();
      } catch {}
    };

    worker.on(
      "message",
      (msg: { taskId: number; matchedIndices: number[]; error: string | null }) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (msg.error) {
          reject(new Error(`Expressão regular inválida: ${msg.error}`));
        } else {
          resolve(msg.matchedIndices);
        }
      }
    );

    worker.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    worker.on("exit", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Worker de regex finalizou inesperadamente com código ${code}`));
    });

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new RegexTimeoutError());
    }, timeoutMs);

    worker.postMessage({ pattern, flags, lines, taskId: 1 });
  });
}
