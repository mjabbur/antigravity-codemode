import { parentPort } from "node:worker_threads";

if (parentPort) {
  parentPort.on(
    "message",
    (msg: { pattern: string; flags: string; lines: string[]; taskId: number }) => {
      try {
        const regex = new RegExp(msg.pattern, msg.flags);
        const matchedIndices: number[] = [];
        for (let i = 0; i < msg.lines.length; i++) {
          if (regex.test(msg.lines[i])) {
            matchedIndices.push(i);
          }
        }
        parentPort!.postMessage({ taskId: msg.taskId, matchedIndices, error: null });
      } catch (err: unknown) {
        parentPort!.postMessage({
          taskId: msg.taskId,
          matchedIndices: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  );
}
