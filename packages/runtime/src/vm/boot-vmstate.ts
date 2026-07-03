import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import debugLib from "debug";

import type { BootOptions } from "./boot.ts";
import { resolveSnapshotEngine } from "./snapshot-engine.ts";

const vmstateDebug = debugLib("machinen:vmstate");
const restoreDebug = debugLib("machinen:restore");

export interface BootVmstateRuntime {
  statePath: string | undefined;
  chainId: string;
  checkpointParent: string | undefined;
  checkpointSequence: number;
}

export function setupVmstateBoot(
  opts: BootOptions,
  env: Record<string, string>,
  inputVsockTempDir: string | undefined,
): { vmstate: BootVmstateRuntime; vsockTempDir: string | undefined } {
  const temp = setupVmstateTemp(opts, inputVsockTempDir);
  const vmstate: BootVmstateRuntime = {
    statePath: temp.stateTempDir ? join(temp.stateTempDir, "state.vmstate") : undefined,
    chainId: randomBytes(16).toString("hex"),
    checkpointParent: opts._vmstateRestorePath !== undefined ? opts.forkedFrom : undefined,
    checkpointSequence: 0,
  };
  applyVmstateEnvPlan(opts, env, vmstate.statePath);
  return { vmstate, vsockTempDir: temp.vsockTempDir };
}

function setupVmstateTemp(
  opts: BootOptions,
  inputVsockTempDir: string | undefined,
): { stateTempDir: string | undefined; vsockTempDir: string | undefined } {
  const tempMode = planVmstateTempMode(
    resolveSnapshotEngine(),
    opts.snapshot === false,
    inputVsockTempDir,
  );
  return resolveVmstateTempMode(tempMode, inputVsockTempDir);
}

function resolveVmstateTempMode(
  mode: { action: "skip" | "reuse" | "allocate"; tempDir?: string },
  inputVsockTempDir: string | undefined,
): { stateTempDir: string | undefined; vsockTempDir: string | undefined } {
  if (mode.action === "skip") {
    return { stateTempDir: undefined, vsockTempDir: inputVsockTempDir };
  }
  if (mode.action === "reuse") {
    return { stateTempDir: mode.tempDir, vsockTempDir: mode.tempDir };
  }
  const tempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
  return { stateTempDir: tempDir, vsockTempDir: tempDir };
}

function applyVmstateEnvPlan(
  opts: BootOptions,
  env: Record<string, string>,
  vmstatePath: string | undefined,
): void {
  if (vmstatePath) {
    env.MACHINEN_SNAPSHOT_PATH = vmstatePath;
  }
  if (opts._vmstateRestorePath) {
    env.MACHINEN_RESTORE_PATH = opts._vmstateRestorePath;
  }
  if (shouldEnableVmstateTiming(opts, env)) {
    env.MACHINEN_VMSTATE_TIMING = "1";
  }
}

function shouldEnableVmstateTiming(opts: BootOptions, env: Record<string, string>): boolean {
  return (
    opts._vmstateRestorePath !== undefined &&
    (vmstateDebug.enabled || restoreDebug.enabled) &&
    !env.MACHINEN_VMSTATE_TIMING
  );
}

function planVmstateTempMode(
  engine: string,
  snapshotDisabled: boolean,
  existingTempDir: string | undefined,
): { action: "skip" | "reuse" | "allocate"; tempDir?: string } {
  if (engine !== "vmstate" || snapshotDisabled) {
    return { action: "skip" };
  }
  return existingTempDir ? { action: "reuse", tempDir: existingTempDir } : { action: "allocate" };
}
