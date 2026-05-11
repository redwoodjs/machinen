// Spawn the live-share mount server as a detached helper process so
// the runtime supervisor can exit cleanly while the helper keeps
// serving FUSE traffic for the still-running VMM (#150 phase 3).
//
// Process model:
//
//   supervisor (this) ─────[spawn]────▶ pdeathsig (--watch-pid VMM)
//                                            │ fork+exec
//                                            ▼
//                                       node mount-server-bin.js
//
// pdeathsig watches the VMM pid (not the supervisor — the supervisor
// exits on purpose). When the VMM dies the watcher SIGTERMs the node
// helper; the helper closes its FUSE listener, flushes its stats
// file, and exits.
//
// Returned handle is shaped like the in-process `LiveMountServerHandle`
// so vm.ts can keep a single array; adds `pid` and `exe` so the
// registry can persist enough to reap the helper from a different
// process (`machinen stop`, `machinen gc`).

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import debugLib from "debug";
import { MountError } from "./errors.ts";
import type { LiveMountServerHandle } from "./mount-server.ts";
import { ensurePdeathsig, wrapWithPdeathsig } from "./pdeathsig.ts";

const debug = debugLib("machinen:mount-server-detached");

/**
 * Extension of the in-process handle that adds the helper's pid and
 * the resolved bin path. Both feed the registry so `machinen stop`
 * and `machinen gc` can reap from a different process after detach.
 */
export interface DetachedMountServerHandle extends LiveMountServerHandle {
  /**
   * The wrapped pid the kernel reports for the spawn. On Linux this
   * is the node helper itself (pdeathsig prctl+execvp's it in place).
   * On macOS this is the pdeathsig watcher (which forks the helper);
   * either way SIGTERMing this pid takes the whole subtree down.
   */
  pid: number;
  /**
   * Resolved bin path (the dist js or src ts run via tsx). Persisted
   * in the registry so a recycled-pid check can validate that the
   * process at `pid` is still our helper.
   */
  exe: string;
}

export interface SpawnDetachedMountServerOptions {
  /** Unix socket the VMM's vsock bridge muxes to the guest fuse port. */
  udsPath: string;
  /** Absolute host directory the guest will see, bound by mount-resolver. */
  rootAbs: string;
  /** Mount mode — `ro` rejects mutations with EROFS, `rw` writes through. */
  mode: "ro" | "rw";
  /**
   * Pid of the VMM process the helper should die with. The shim
   * watches this pid via kqueue (macOS) or pidfd_open (Linux); when
   * it exits, SIGTERM is forwarded to the helper. Pass the value
   * Node returned for the VMM `child.pid`.
   */
  vmmPid: number;
  /**
   * Path the helper writes its bytesServedOnPagesImg counter to.
   * Caller chooses the path — typically under the same temp dir that
   * holds the live-mount UDSes — and is responsible for rming the
   * parent dir on cleanup. Helper does a final write on shutdown.
   */
  statsPath: string;
}

/**
 * Spawn the standalone mount-server bin in a detached subtree wrapped
 * by `pdeathsig --watch-pid <vmmPid>`. Resolves once we've confirmed
 * the helper has bound the UDS (poll for socket existence). Throws
 * MOUNT_SERVER_SPAWN_FAILED if the helper exits before that happens.
 *
 * The returned handle is `unref()`'d so this process can exit without
 * waiting on the helper.
 */
export async function spawnDetachedMountServer(
  opts: SpawnDetachedMountServerOptions,
): Promise<DetachedMountServerHandle> {
  if (!Number.isInteger(opts.vmmPid) || opts.vmmPid <= 0) {
    throw new MountError(
      "MOUNT_SERVER_SPAWN_FAILED",
      `spawnDetachedMountServer: invalid vmmPid ${opts.vmmPid}`,
    );
  }
  const resolved = resolveMountServerCommand();
  const helperArgs = [
    ...resolved.args,
    "--uds",
    opts.udsPath,
    "--root",
    opts.rootAbs,
    "--mode",
    opts.mode,
    "--stats",
    opts.statsPath,
  ];
  const pdeathsigBin = await ensurePdeathsig();
  const wrapped = wrapWithPdeathsig(pdeathsigBin, resolved.command, helperArgs, {
    watchPid: opts.vmmPid,
  });
  debug(
    "spawn uds=%s root=%s mode=%s vmm=%d shim=%s",
    opts.udsPath,
    opts.rootAbs,
    opts.mode,
    opts.vmmPid,
    pdeathsigBin ? "yes" : "no",
  );
  const child = nodeSpawn(wrapped.command, wrapped.args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Drop the event-loop pin so the supervisor can exit. Stdio stays
  // piped (drained below) but a paused pipe doesn't keep the loop
  // alive on its own.
  child.unref();
  // Drain stderr to a debug stream — the helper might warn about
  // FUSE protocol oddities, and an undrained pipe will eventually
  // backpressure it.
  child.stderr?.on("data", (chunk: Buffer) => {
    debug("stderr: %s", chunk.toString().trimEnd());
  });
  child.stdout?.on("data", () => {});

  await waitForSocketOrExit(child, opts.udsPath);

  const pid = child.pid;
  if (pid === undefined || pid <= 0) {
    throw new MountError(
      "MOUNT_SERVER_SPAWN_FAILED",
      "spawnDetachedMountServer: helper started but pid is unset",
    );
  }
  return makeHandle(child, pid, wrapped.command, opts);
}

function makeHandle(
  child: ChildProcess,
  pid: number,
  exe: string,
  opts: SpawnDetachedMountServerOptions,
): DetachedMountServerHandle {
  let stopped = false;
  return {
    pid,
    exe,
    bytesServedOnPagesImg: () => readBytesServed(opts.statsPath),
    stop: async () => {
      if (stopped) {
        return;
      }
      stopped = true;
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGTERM");
        } catch {}
      }
      // Wait for the helper to actually exit before we tear down its
      // socket / stats — otherwise a concurrent stats write could
      // recreate the file we just rm'd. Bounded wait: 5s, then
      // SIGKILL fallback so a wedged helper can't strand callers.
      await waitForExit(child, 5000);
      for (const path of [opts.statsPath, opts.udsPath]) {
        try {
          rmSync(path, { force: true });
        } catch {}
      }
    },
  };
}

function readBytesServed(statsPath: string): number {
  try {
    const raw = readFileSync(statsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "bytesServedOnPagesImg" in parsed &&
      typeof (parsed as { bytesServedOnPagesImg: unknown }).bytesServedOnPagesImg === "number"
    ) {
      return (parsed as { bytesServedOnPagesImg: number }).bytesServedOnPagesImg;
    }
    return 0;
  } catch {
    // Helper not yet started, was killed -9, or wrote a torn snapshot
    // we caught mid-rename. Either way: zero is the right floor.
    return 0;
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, timeoutMs);
    timer.unref();
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForSocketOrExit(child: ChildProcess, udsPath: string): Promise<void> {
  // Helper does an `await server.listen(udsPath)` before any other
  // work, so the socket appearing is a strong readiness signal. Cap
  // at 3s to surface bin/argv mistakes fast.
  const deadline = Date.now() + 3000;
  let earlyExitErr: Error | null = null;
  const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
    earlyExitErr = new Error(
      `mount-server helper exited before socket was ready (code=${code} signal=${signal})`,
    );
  };
  child.once("exit", onExit);
  try {
    while (Date.now() < deadline) {
      if (existsSync(udsPath)) {
        return;
      }
      if (earlyExitErr) {
        throw earlyExitErr;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    if (earlyExitErr) {
      throw earlyExitErr;
    }
    // Socket never appeared and the child is still alive. Kill it so
    // we don't leak a wedged helper, then surface the timeout.
    try {
      child.kill("SIGKILL");
    } catch {}
    throw new MountError(
      "MOUNT_SERVER_SPAWN_FAILED",
      `mount-server helper did not bind ${udsPath} within 3000ms`,
    );
  } finally {
    child.removeListener("exit", onExit);
  }
}

interface ResolvedCommand {
  command: string;
  args: string[];
}

let cachedCommand: ResolvedCommand | null = null;

/**
 * Locate the standalone mount-server bin. Production: dist sibling
 * built by tsup. Dev/test: source .ts file run via `node --import tsx`
 * (Node 20.6+'s loader-hook flag — tsx is a workspace devDependency).
 * Override with `MACHINEN_MOUNT_SERVER_BIN=/abs/path` when neither
 * fits (custom builds, packaged runtimes elsewhere).
 *
 * Resolution is cached after the first call — `import.meta.url` and
 * the dist/src layout don't change at runtime.
 */
function resolveMountServerCommand(): ResolvedCommand {
  if (cachedCommand) {
    return cachedCommand;
  }
  const override = process.env.MACHINEN_MOUNT_SERVER_BIN;
  if (override) {
    if (!existsSync(override)) {
      throw new MountError(
        "MOUNT_SERVER_BIN_MISSING",
        `MACHINEN_MOUNT_SERVER_BIN=${override} does not exist`,
      );
    }
    // Honor whatever the override points at — if it ends in .ts we
    // still need tsx, otherwise plain node. The shape mirrors the
    // dist/src branches below.
    cachedCommand = override.endsWith(".ts")
      ? { command: process.execPath, args: ["--import", "tsx", override] }
      : { command: process.execPath, args: [override] };
    return cachedCommand;
  }

  const distUrl = new URL("./mount-server-bin.js", import.meta.url);
  const distPath = fileURLToPath(distUrl);
  if (existsSync(distPath)) {
    cachedCommand = { command: process.execPath, args: [distPath] };
    return cachedCommand;
  }

  const srcUrl = new URL("./mount-server-bin.ts", import.meta.url);
  const srcPath = fileURLToPath(srcUrl);
  if (existsSync(srcPath)) {
    cachedCommand = { command: process.execPath, args: ["--import", "tsx", srcPath] };
    return cachedCommand;
  }

  throw new MountError(
    "MOUNT_SERVER_BIN_MISSING",
    `mount-server bin not found at ${distPath} or ${srcPath}. ` +
      `Run pnpm build, or set MACHINEN_MOUNT_SERVER_BIN to an absolute path.`,
  );
}
