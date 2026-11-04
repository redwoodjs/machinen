// Spawn and lifecycle for the Swift Virtualization.framework runner.
//
// One runner process per VM, so the registry PID is a real per-VM PID and
// the existing `kill(pid, 0)` liveness and PID-recycling checks keep
// working unchanged. The runner owns the guest; this module owns the
// process and its status file.

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, platform as osPlatform } from "node:os";
import { join } from "node:path";

import { BootError } from "../../errors.ts";
import { readProcessIdentity } from "../../pid-validate.ts";
import type { MacosBundle } from "./config.ts";

const require_ = createRequire(import.meta.url);

export interface RunnerSpawnOptions {
  /** Absolute path to the built runner executable. */
  binary: string;
  bundle: MacosBundle;
  memoryMib: number;
  cpuCount: number;
  /** Directory the runner writes `status.json` into. */
  stateDir: string;
  /** Streaming console callback. */
  onLog?: (chunk: Buffer) => void;
}

export interface SpawnedRunner {
  child: ChildProcess;
  pid: number;
  statusPath: string;
  /** Absolute bundle path, persisted as the registry providerRef. */
  providerRef: string;
}

/**
 * Resolve the runner executable from the native package, honoring the same
 * override style the VMM uses so tests and dev builds can point elsewhere.
 */
export function resolveVzRunnerBinary(): string {
  const override = process.env.MACHINEN_VZ_RUNNER;
  if (override) {
    if (!existsSync(override)) {
      throw new BootError(
        "BOOT_VMM_MISSING",
        `MACHINEN_VZ_RUNNER is set to ${override}, but that file does not exist.`,
      );
    }
    return override;
  }
  const key = `${osArch()}-${osPlatform()}`;
  const pkgName = `@machinen/native-${key}`;
  try {
    const mod = require_(pkgName) as { vzRunner?: string };
    if (!mod.vzRunner || !existsSync(mod.vzRunner)) {
      throw new BootError(
        "BOOT_VMM_MISSING",
        `${pkgName} is installed but its VZ runner is missing at ${mod.vzRunner ?? "<unset>"}. ` +
          "Build it with packages/native-arm64-darwin/vz-runner/build.sh.",
      );
    }
    return mod.vzRunner;
  } catch (err) {
    if (err instanceof BootError) {
      throw err;
    }
    throw new BootError(
      "BOOT_VMM_MISSING",
      "no macOS VZ runner found. Build it with " +
        "`packages/native-arm64-darwin/vz-runner/build.sh`, or set MACHINEN_VZ_RUNNER.",
      { cause: err },
    );
  }
}

export function spawnRunner(opts: RunnerSpawnOptions): SpawnedRunner {
  const statusPath = join(opts.stateDir, "status.json");
  const args = [
    "--bundle",
    opts.bundle.path,
    "--memory-mib",
    String(opts.memoryMib),
    "--cpus",
    String(opts.cpuCount),
    "--status-file",
    statusPath,
  ];
  const child = spawn(opts.binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });
  if (opts.onLog) {
    child.stdout?.on("data", opts.onLog);
    child.stderr?.on("data", opts.onLog);
  }
  const pid = child.pid;
  if (pid === undefined) {
    throw new BootError("PROVIDER_READINESS_FAILED", "macOS runner failed to spawn.");
  }
  return { child, pid, statusPath, providerRef: opts.bundle.path };
}

/**
 * Identity snapshot for the registry, so a later `attach()` can tell a
 * recycled PID from the real runner.
 */
export function runnerProcessIdentity(
  pid: number,
): { exeBase: string; startedAtMs?: number } | undefined {
  return readProcessIdentity(pid);
}

export function removeRunnerState(stateDir: string): void {
  rmSync(stateDir, { recursive: true, force: true });
}

/** Last-resort read of the runner's own reported version. */
export function readRunnerVersion(binary: string): string | undefined {
  if (!existsSync(binary)) {
    return undefined;
  }
  try {
    return readFileSync(`${binary}.version`, "utf8").trim();
  } catch {
    return undefined;
  }
}
