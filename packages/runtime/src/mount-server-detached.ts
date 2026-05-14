// Spawn the Zig-native live-mount server (#329) as a detached helper
// process so the runtime supervisor can exit cleanly while the helper
// keeps serving FUSE traffic for the still-running VMM (#150 phase 3).
//
// Process model:
//
//   supervisor (this) ─────[spawn]────▶ pdeathsig (--watch-pid VMM)
//                                            │ fork+exec
//                                            ▼
//                                       machinen-mount-server (Zig)
//
// pdeathsig watches the VMM pid (not the supervisor — the supervisor
// exits on purpose). When the VMM dies the watcher SIGTERMs the helper;
// the helper closes its FUSE listener, flushes its stats file, and exits.
//
// Returned handle is shaped to be a drop-in for the previous in-process
// JS server's handle — same methods, plus `pid` and `exe` so the registry
// can persist enough to reap the helper from a different process
// (`machinen stop`, `machinen gc`).

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import debugLib from "debug";
import { MountError } from "./errors.ts";
import { ensurePdeathsig, wrapWithPdeathsig } from "./pdeathsig.ts";

const debug = debugLib("machinen:mount-server-detached");

/**
 * Per-FUSE-op latency snapshot, surfaced by the helper's `--stats`
 * file when `MACHINEN_MOUNT_SERVER_PROFILE=1` (#329 baseline).
 *
 * Times are nanoseconds; `count` and `sumNs` are populated. The Zig
 * server reports `p50Ns` / `p99Ns` as `0` in PR1 — percentile ring is
 * a follow-up. The shape is preserved so dashboards / readers don't
 * break when the fields start being populated.
 */
export interface OpHistogram {
  count: number;
  sumNs: number;
  p50Ns: number;
  p99Ns: number;
}

/**
 * Public handle returned by `spawnDetachedMountServer`. Shape preserved
 * from the previous in-process JS implementation so call sites in
 * vm/boot.ts don't change.
 */
export interface DetachedMountServerHandle {
  /** Stop the helper; idempotent. */
  stop(): Promise<void>;
  /**
   * Bytes served from any `pages-*.img` file under this mount since
   * startup (#274). Used by `vm.memoryStats()` to approximate the
   * lazy-restore page-fault progress.
   */
  bytesServedOnPagesImg(): number;
  /**
   * Per-op latency snapshot (#329 baseline). Returns an empty object
   * unless the server was started with `MACHINEN_MOUNT_SERVER_PROFILE=1`.
   */
  opStats(): Record<string, OpHistogram>;
  /**
   * The pid the kernel reports for the spawn. SIGTERMing this pid
   * takes the whole subtree (pdeathsig wrapper + helper) down.
   */
  pid: number;
  /**
   * Resolved bin path (the Zig artifact). Persisted in the registry so
   * a recycled-pid check can validate that the process at `pid` is
   * still our helper.
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
    opStats: () => readOpStats(opts.statsPath),
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
  const snap = readStatsSnapshot(statsPath);
  return typeof snap?.bytesServedOnPagesImg === "number" ? snap.bytesServedOnPagesImg : 0;
}

function readOpStats(statsPath: string): Record<string, OpHistogram> {
  const snap = readStatsSnapshot(statsPath);
  // Field is optional in the schema — absent means profile mode was off,
  // present-but-empty means profile mode was on with no traffic yet.
  if (
    snap &&
    typeof snap === "object" &&
    "ops" in snap &&
    snap.ops &&
    typeof snap.ops === "object"
  ) {
    return snap.ops as Record<string, OpHistogram>;
  }
  return {};
}

/**
 * Read + parse the helper's stats file. Returns `null` if the file is
 * missing, JSON-malformed, or caught mid-rename. Both accessor helpers
 * derive from this — accepting two file reads when both are queried is
 * fine for a bench (querying happens once at shutdown).
 */
function readStatsSnapshot(statsPath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(statsPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    // Helper not yet started, was killed -9, or wrote a torn snapshot
    // we caught mid-rename. Zero/empty is the right floor for callers.
    return null;
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

let cachedRequire: NodeRequire | null = null;

/**
 * Locate the Zig mount-server binary for the current host via the
 * consolidated `@machinen/native-<arch>-<os>` package's `mountServer`
 * export. npm/pnpm install only the package whose `os` + `cpu` match
 * the host, so a successful resolve means the binary is on disk.
 *
 * Override with `MACHINEN_MOUNT_SERVER_BIN=/abs/path` when neither
 * fits (custom builds, packaged runtimes elsewhere).
 *
 * Cached after the first call — the package layout doesn't change at
 * runtime.
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
    cachedCommand = { command: override, args: [] };
    return cachedCommand;
  }
  const zigBin = resolveZigBinary();
  if (zigBin) {
    cachedCommand = { command: zigBin, args: [] };
    return cachedCommand;
  }
  const pkg = `@machinen/native-${process.arch}-${process.platform}`;
  throw new MountError(
    "MOUNT_SERVER_BIN_MISSING",
    `machinen-mount-server binary not found. Expected \`${pkg}\` to be ` +
      "installed alongside `@machinen/runtime` with its mount-server " +
      "binary staged. Run `bash scripts/build-mount-server.sh` from the " +
      "repo root, or set MACHINEN_MOUNT_SERVER_BIN.",
  );
}

/**
 * Resolve the mount-server binary from `@machinen/native-<arch>-<os>`.
 * Returns `null` if that package isn't installed for this host or its
 * binary hasn't been staged yet — callers treat that as a hard error.
 */
function resolveZigBinary(): string | null {
  const pkg = `@machinen/native-${process.arch}-${process.platform}`;
  try {
    cachedRequire ??= createRequire(import.meta.url);
    const mod = cachedRequire(pkg) as { mountServer?: string };
    if (mod.mountServer && existsSync(mod.mountServer)) {
      return mod.mountServer;
    }
    return null;
  } catch {
    // Optional dep not installed for this arch+os.
    return null;
  }
}
