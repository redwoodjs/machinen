import type { NativeProcessImageRefusal } from "@machinen/runtime";

export interface MoveLoadDirectLoader {
  state: "ready" | "refused";
  strategy: string;
  executable: string;
  argv: string[];
  targetPid?: number;
  logPath?: string;
  capture?: unknown;
  patch?: { state: "ready" | "refused"; stdout: string; stderr: string; exitCode: number };
  refusals: NativeProcessImageRefusal[];
}
