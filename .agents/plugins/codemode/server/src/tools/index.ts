import type { PathPolicy } from "../security/path-policy.ts";
import type { CodemodeTool } from "../sandbox/types.ts";
import { createFsReadTools } from "./fs-read.ts";
import { createFsWriteTools } from "./fs-write.ts";

export * from "./fs-read.ts";
export * from "./fs-write.ts";
export * from "./ripwire.ts";

export function createFsTools(policy: PathPolicy): CodemodeTool[] {
  return [...createFsReadTools(policy), ...createFsWriteTools(policy)];
}
