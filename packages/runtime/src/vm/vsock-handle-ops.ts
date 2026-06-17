import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { ExecError } from "../errors.ts";
import { VsockExec } from "../exec.ts";
import type { VmHandle } from "../vm-handle.ts";
import { runVsockWithBootDiagnostics } from "./boot-diagnostics.ts";

export function makeReseedVmstateEntropy(
  vsockUdsPath: string | undefined,
  child: ChildProcessWithoutNullStreams,
  errorCollector: Promise<string>,
): NonNullable<VmHandle["reseedVmstateEntropy"]> {
  return (seedHex, execOpts) => {
    if (!vsockUdsPath) {
      return Promise.reject(missingVsockError("reseedVmstateEntropy"));
    }
    return runVsockWithBootDiagnostics(child, errorCollector, () =>
      VsockExec.reseedVmstate(vsockUdsPath, seedHex, execOpts),
    );
  };
}

export function makeSyncVmstateSnapshot(
  vsockUdsPath: string | undefined,
  child: ChildProcessWithoutNullStreams,
  errorCollector: Promise<string>,
): NonNullable<VmHandle["syncVmstateSnapshot"]> {
  return (execOpts) => {
    if (!vsockUdsPath) {
      return Promise.reject(missingVsockError("syncVmstateSnapshot"));
    }
    return runVsockWithBootDiagnostics(child, errorCollector, () =>
      VsockExec.syncVmstate(vsockUdsPath, execOpts),
    );
  };
}

function missingVsockError(method: string): ExecError {
  return new ExecError(
    "EXEC_VSOCK_UNAVAILABLE",
    `vm.${method}: no vsock UDS available — MACHINEN_VSOCK was set to an ` +
      "unrecognized spec. Expected `in:<port>:<uds-path>`.",
  );
}
