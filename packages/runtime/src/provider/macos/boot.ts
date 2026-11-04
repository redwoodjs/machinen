// macOS guest boot.
//
// Reached from `boot()` only after the provider selector picks `apple-vz`,
// so no Linux asset work has run. Order is deliberate: validate host,
// validate the bundle, validate resources, spawn the runner, wait for a
// real readiness signal, then open the SSH transport.

import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BootError } from "../../errors.ts";
import { claimName, removeEntry, writeEntry } from "../../registry.ts";
import type { VmHandle } from "../../vm-handle.ts";
import { assertProviderHostSupported, type ProviderSelection } from "../select.ts";
import { MACOS_CAPABILITIES } from "../types.ts";
import {
  resolveMacosBundle,
  validateMacosResources,
  validateMacosSsh,
  type MacosBundle,
  type MacosBootOptions,
} from "./config.ts";
import { createMacosHandle } from "./handle.ts";
import { resolveVzRunnerBinary, spawnRunner, type SpawnedRunner } from "./runner.ts";
import { readRunnerStatus, waitForRunnerRunning } from "./runner-status.ts";
import { createMacosTransport, makeTransportStateDir } from "./ssh.ts";
import type { BootOptions } from "../../vm/boot.ts";

/** Guest port the exec agent would use. Not a session service. */
const DEFAULT_READINESS_TIMEOUT_MS = 180_000;

export async function bootMacosGuest(
  opts: BootOptions,
  selection: ProviderSelection,
): Promise<VmHandle> {
  assertProviderHostSupported(selection);
  const macos = opts.macos;
  if (!macos) {
    throw new BootError(
      "PROVIDER_IMAGE_INVALID",
      'guestOS "macos" requires a `macos` configuration block with a prepared bundle and SSH settings.',
    );
  }
  rejectLinuxOnlyOptions(opts);
  validateMacosSsh(macos.ssh);
  const resources = validateMacosResources(macos);
  const bundle = resolveMacosBundle(macos.source, opts.cwd);

  const stateDir = mkdtempSync(join(tmpdir(), "machinen-macos-runner-"));
  const transportDir = makeTransportStateDir();
  let spawned: SpawnedRunner | undefined;
  let registered = false;
  try {
    spawned = spawnRunner({
      binary: resolveVzRunnerBinary(),
      bundle,
      memoryMib: resources.memoryMib,
      cpuCount: resources.cpuCount,
      stateDir,
      onLog: opts.onLog ? (chunk) => opts.onLog?.({ source: "guest-console", chunk }) : undefined,
    });
    await waitForRunnerRunning({
      statusPath: spawned.statusPath,
      timeoutMs: opts.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS,
      isAlive: () => isRunnerAlive(spawned!),
    });
    const status = readRunnerStatus(spawned.statusPath);
    const host = macos.ssh.host ?? status?.address;
    if (!host) {
      throw new BootError(
        "PROVIDER_READINESS_FAILED",
        "macOS runner reached running state without reporting a guest address. " +
          "Set `macos.ssh.host` to skip discovery.",
      );
    }
    const transport = createMacosTransport({ ssh: macos.ssh, host, stateDir: transportDir });
    await assertSshReady(transport, opts.timeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS);

    const runner = spawned;
    claimOrThrow(opts.name, runner.pid);
    writeEntry({
      pid: runner.pid,
      name: opts.name,
      // No vsock UDS exists for this provider. An empty string would look
      // like a broken bridge, so record the SSH endpoint instead.
      socketPath: `${macos.ssh.user}@${host}:${macos.ssh.port ?? 22}`,
      guestOS: "macos",
      provider: selection.provider,
      providerRef: runner.providerRef,
      capabilities: MACOS_CAPABILITIES,
      startedAt: Date.now(),
      cleanupPaths: [stateDir, transportDir],
    });
    registered = true;

    const handle = createMacosHandle({
      pid: runner.pid,
      name: opts.name,
      transport,
      wait: () => waitForRunnerExit(runner),
      kill: () => stopRunner(runner, transport),
    });
    if (opts.detached) {
      runner.child.unref();
      runner.child.stdout?.destroy();
      runner.child.stderr?.destroy();
    }
    return handle;
  } catch (err) {
    if (spawned) {
      killQuietly(spawned);
      if (registered) {
        removeEntry(spawned.pid);
      }
    }
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(transportDir, { recursive: true, force: true });
    throw err;
  }
}

/**
 * Refuse Linux-only options before spawning. Silently ignoring them would
 * produce a guest that does not match what the caller asked for.
 */
function rejectLinuxOnlyOptions(opts: BootOptions): void {
  const rejected: string[] = [];
  if (opts.snapshot !== undefined && opts.snapshot !== false) {
    rejected.push("snapshot");
  }
  if (opts.mount !== undefined) {
    rejected.push("mount");
  }
  if (opts.liveMounts !== undefined && opts.liveMounts.length > 0) {
    rejected.push("liveMounts");
  }
  if (opts.portForward !== undefined && opts.portForward.length > 0) {
    rejected.push("portForward");
  }
  if (opts.nested) {
    rejected.push("nested");
  }
  if (opts.rootDisk !== undefined) {
    rejected.push("rootDisk");
  }
  if (opts.kernel !== undefined || opts.dtb !== undefined) {
    rejected.push("kernel/dtb");
  }
  if (opts.image !== undefined) {
    rejected.push("image");
  }
  if (opts.cmd !== undefined && opts.cmd.length > 0) {
    rejected.push("cmd");
  }
  if (rejected.length > 0) {
    throw new BootError(
      "PROVIDER_UNSUPPORTED_OPERATION",
      `guestOS "macos" does not support ${rejected.join(", ")}. ` +
        "A macOS guest boots a prepared bundle and is driven over SSH.",
    );
  }
}

async function assertSshReady(
  transport: ReturnType<typeof createMacosTransport>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const result = await transport.exec("true", {
        connectTimeoutMs: 5_000,
        execTimeoutMs: 10_000,
      });
      if (result.exitCode === 0) {
        return;
      }
      lastError = new Error(result.stderr || `ssh exited ${result.exitCode}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 500);
      timer.unref?.();
    });
  }
  throw new BootError(
    "PROVIDER_TRANSPORT_FAILED",
    "macOS guest never answered over SSH. Check the guest's Remote Login setting, " +
      `the identity file, and the reported address. Last error: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    { cause: lastError },
  );
}

function claimOrThrow(name: string | undefined, pid: number): void {
  if (!name) {
    return;
  }
  if (claimName(name, pid)) {
    return;
  }
  throw new BootError(
    "REGISTRY_NAME_IN_USE",
    `boot: name ${JSON.stringify(name)} is already held by a live VM.`,
  );
}

function isRunnerAlive(runner: SpawnedRunner): boolean {
  return runner.child.exitCode === null && runner.child.signalCode === null;
}

function waitForRunnerExit(
  runner: SpawnedRunner,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (runner.child.exitCode !== null || runner.child.signalCode !== null) {
    return Promise.resolve({ code: runner.child.exitCode, signal: runner.child.signalCode });
  }
  return new Promise((resolve) => {
    runner.child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function stopRunner(
  runner: SpawnedRunner,
  transport: ReturnType<typeof createMacosTransport>,
): Promise<void> {
  try {
    await transport.exec("sudo -n shutdown -h now || true", { execTimeoutMs: 15_000 });
  } catch {
    // Guest-side shutdown is best effort; the runner still gets signaled.
  }
  runner.child.kill("SIGTERM");
  const exited = await Promise.race([
    waitForRunnerExit(runner).then(() => true),
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 30_000);
      timer.unref?.();
    }),
  ]);
  if (!exited) {
    runner.child.kill("SIGKILL");
    await waitForRunnerExit(runner);
  }
  removeEntry(runner.pid);
}

function killQuietly(runner: SpawnedRunner): void {
  try {
    runner.child.kill("SIGKILL");
  } catch {
    // Already gone.
  }
}

/** Session nonce reserved for a future Darwin agent handshake. */
export function makeSessionNonce(): string {
  return randomBytes(16).toString("hex");
}

export type { MacosBootOptions, MacosBundle };
