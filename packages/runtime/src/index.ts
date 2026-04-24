export { Sandboxes, Supervisor } from "./multiplex.ts";
export type { SandboxEntry, OnOutputListener, SupervisorOptions } from "./multiplex.ts";
export { bootPty } from "./pty.ts";
export type { PtyBootOptions, PtyVmHandle } from "./pty.ts";
export { VsockWinsize } from "./winsize.ts";
export type { VsockWinsizeOptions } from "./winsize.ts";
export { VsockSecrets } from "./secrets.ts";
export type { VsockSecretsOptions } from "./secrets.ts";
export { VsockFiles } from "./files.ts";
export type { VsockFilesOptions } from "./files.ts";
export { VsockExec } from "./exec.ts";
export type { VsockExecOptions, VsockExecResult } from "./exec.ts";
export { provision, ProvisionError, resolveBaseRootfs } from "./provision.ts";
export type { ProvisionOptions, ProvisionResult } from "./provision.ts";
export { spawnArtifactCache, resolveCacheDir } from "./artifact-cache.ts";
export type { ArtifactCacheHandle, ArtifactCacheOptions } from "./artifact-cache.ts";
export { list, registryRoot } from "./registry.ts";
export type { RegistryEntry } from "./registry.ts";
export {
  packBundle as mkinitramfsBundle,
  packRootfs as mkinitramfsRootfs,
  packWorkspace as mkinitramfsWorkspace,
  packMinimal as mkinitramfsMinimal,
  cli as mkinitramfsCli,
} from "./mkinitramfs.ts";

// @machinen/runtime — TypeScript surface for booting microVMs.
//
// The Zig VMM is a separate binary (today: the test binary produced
// by `zig build test` in packages/microvm). This package wraps it so
// application code can say:
//
//   const vm = await boot({ image: "./rootfs.tar.gz", cmd: ["/bin/sh"] });
//   await vm.exec("uname -a");
//   await vm.wait();
//
// #50 M2 adds CRIU snapshot/restore on top:
//
//   const vm = await boot({ image, cmd });
//   await vm.exec("prep stuff");
//   await vm.snapshot("./warm.snap");           // CRIU dumps; VM exits
//
//   const restored = await boot({ snapshot: "./warm.snap" });
//   // restored is running a process that was frozen in the prior VMM.
//
// No multiplexing yet — one VM per handle (#51 is its own issue).

import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, platform as osPlatform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { packBundle as mkinitramfsPackBundle } from "./mkinitramfs.ts";
import { exposePort, resolveGvproxyBinary, spawnGvproxy, warnGvproxyMissing } from "./gvproxy.ts";
import { spawnArtifactCache } from "./artifact-cache.ts";
import { VsockExec, type VsockExecOptions, type VsockExecResult } from "./exec.ts";
import { findEntry, isAlive, newVmId, removeEntry, writeEntry } from "./registry.ts";

export class BootError extends Error {}

const require_ = createRequire(import.meta.url);

/**
 * Locate the VMM binary using the same lookup order as `@machinen/cli`:
 *   1. `MACHINEN_VMM` env var (dev-mode override)
 *   2. `require.resolve("@machinen/vmm-<arch>-<os>")` → `binary` export
 *
 * Callers can pass an explicit `binary` to `boot()` to bypass this.
 */
export function resolveVmmBinary(): string {
  const envOverride = process.env.MACHINEN_VMM;
  if (envOverride) {
    const abs = resolve(envOverride);
    if (!existsSync(abs)) {
      throw new BootError(`MACHINEN_VMM is set to ${envOverride}, but that file does not exist.`);
    }
    return abs;
  }

  const key = `${osArch()}-${osPlatform()}`;
  const pkgName = `@machinen/vmm-${key}`;
  try {
    const mod = require_(pkgName) as { binary: string };
    if (!mod.binary || !existsSync(mod.binary)) {
      throw new BootError(`${pkgName} is installed but its binary is missing at ${mod.binary}.`);
    }
    return mod.binary;
  } catch (err) {
    if (err instanceof BootError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new BootError(
      `No VMM binary found for ${key}.\n` +
        `  Expected package: ${pkgName}\n` +
        `  Install: npm i ${pkgName}   (or npm i -g @machinen/cli)\n` +
        `  Error: ${msg}`,
    );
  }
}

export interface BootOptions {
  /**
   * Path to a rootfs tarball to boot from (e.g. the output of
   * `provision()`, or `rootfs-debian-arm64.tar.gz` shipped in releases).
   * Paired with `cmd` — both required, or neither (test-mode binary
   * boots and snapshot-only restores both skip initramfs packing).
   */
  image?: string;
  /**
   * Command to run inside the guest. Packed into the synthesized
   * `/machinen-config.json`. Paired with `image` — both required, or
   * neither.
   */
  cmd?: string[];
  /**
   * Env vars exposed to the guest workload. Packed into the synthesized
   * `/machinen-config.json`. Distinct from `vmmEnv`, which only affects
   * the host-side VMM process.
   */
  env?: Record<string, string>;
  /**
   * Attach this host file as `/dev/vda` inside the guest. Typically a
   * CRIU snapshot image produced by `vm.snapshot()`, for a sub-second
   * restore on boot. See #47 (virtio-blk) and #50.
   */
  snapshot?: string;
  /**
   * A single host directory copied into the guest at boot. The guest
   * path must live under `/mnt/`. Copy-once semantics: guest writes are
   * discarded when the VM exits. See #64, #78.
   */
  mount?: { host: string; guest: string };
  /**
   * Host -> guest TCP port forwards installed via gvproxy's control
   * API. Each entry maps `hostPort` on the host (bound to `hostAddr`,
   * default `127.0.0.1`) to `guestPort` inside the guest.
   */
  portForward?: Array<{ hostPort: number; guestPort: number; hostAddr?: string }>;

  // --- host/VMM-process config ---

  /**
   * Absolute or cwd-relative path to the VMM binary. Optional —
   * if omitted, `boot()` resolves it via `resolveVmmBinary()`.
   */
  binary?: string;
  /** Working directory for the VMM (for finding fixture files). */
  cwd?: string;
  /** Extra argv for the VMM. */
  args?: string[];
  /** Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`. */
  kernel?: string;
  /** Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`. */
  dtb?: string;
  /**
   * Milliseconds to wait in `wait()` before giving up and rejecting.
   * Defaults to 60s. Pass `null` to wait forever.
   */
  timeoutMs?: number | null;
  /**
   * Env passed to the VMM process on the host side (not exposed to the
   * guest workload). Mostly for dev/test flags like `MACHINEN_BOOT_TEST`.
   */
  vmmEnv?: Record<string, string>;
  /**
   * Optional human-friendly name for this VM. When set, `attach({ name })`
   * can reconnect from another process. Auto-assigned id is always set;
   * name is just for discovery.
   */
  name?: string;
}

export interface VmHandle {
  /** Auto-generated short id registered at boot. Stable across attach. */
  readonly id: string;
  /** Optional human-friendly name passed to `boot({ name })`. */
  readonly name?: string;
  readonly pid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;

  /** Resolves when the VM process exits. Rejects on timeout. */
  wait(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

  /** Send SIGKILL to the VM. Resolves once it's really gone. */
  kill(): Promise<void>;

  /**
   * Drop this host-side handle without killing the VMM. The VM keeps
   * running and can be re-attached from another process. For locally-
   * booted handles this closes captured streams; `wait()` and
   * `exec()` become unreliable afterwards.
   */
  detach(): Promise<void>;

  /** Buffer stdout until the process exits; return it as a UTF-8 string. */
  output(): Promise<string>;

  /** Same as `output()` but for stderr (where guest console lands). */
  errorOutput(): Promise<string>;

  /**
   * Run a shell command inside the guest via the vsock exec-agent. Throws
   * BootError on non-zero exit; callers who want to inspect failure
   * should use `execRaw`.
   *
   * Requires the rootfs to have the exec-agent running on vsock port 1978
   * (the standard debian base ships it). The vsock bridge is set up
   * automatically by `boot()` unless the caller pre-set MACHINEN_VSOCK.
   */
  exec(cmd: string, opts?: VsockExecOptions): Promise<VsockExecResult>;

  /** Like `exec()` but returns non-zero exit codes instead of throwing. */
  execRaw(cmd: string, opts?: VsockExecOptions): Promise<VsockExecResult>;

  /**
   * Freeze this VM with CRIU and write the image to `outPath`.
   *
   * The caller must have booted the VM with `disk: <path>` so CRIU has
   * a target to write to; `vm.snapshot()` copies that disk to `outPath`
   * once the dump completes. If boot had no disk attached, this throws.
   *
   * Guest contract: the rootfs must ship a dump helper callable via
   * vsock exec that (1) runs `criu dump` against the workload process,
   * (2) writes `dump OK` to the console, and (3) triggers PSCI
   * SYSTEM_OFF. Default path is `/sbin/machinen-dump` — override via
   * `opts.dumpCmd`. Implemented by #50.
   *
   * The VM exits as part of the dump. To continue using the VM
   * afterwards, boot a new one from the produced snapshot.
   */
  snapshot(outPath: string, opts?: SnapshotOptions): Promise<SnapshotResult>;
}

export interface SnapshotOptions {
  /**
   * Command to run in the guest to trigger the CRIU dump. Defaults to
   * `/sbin/machinen-dump`.
   */
  dumpCmd?: string;
  /**
   * Wall-clock ceiling for the dump + shutdown. If the VMM hasn't exited
   * in this window we SIGKILL it and fail. Default 90s.
   */
  timeoutMs?: number;
}

export interface SnapshotResult {
  /** Absolute path to the written snapshot image. */
  snapshotPath: string;
  /** Time from `snapshot()` entry to VMM exit, in milliseconds. */
  elapsedMs: number;
  /** Guest console output captured during the dump. */
  consoleLog: string;
}

export async function boot(opts: BootOptions = {}): Promise<VmHandle> {
  // Validate portForward up front — before resolving the binary or
  // touching the filesystem — so caller-input errors surface with a
  // clear message. The env-dependent "pre-set MACHINEN_NET_SOCKET"
  // check happens alongside since it only reads env.
  const portForward = opts.portForward ?? [];
  if (portForward.length > 0) {
    const preSetNetSock =
      (opts.vmmEnv && opts.vmmEnv.MACHINEN_NET_SOCKET) || process.env.MACHINEN_NET_SOCKET;
    if (preSetNetSock) {
      throw new BootError(
        "portForward requires the runtime to own gvproxy, but MACHINEN_NET_SOCKET " +
          "is already set. Either drop the env var or install the forwards yourself " +
          "against your gvproxy's control API.",
      );
    }
    const seen = new Set<number>();
    for (const m of portForward) {
      for (const [label, port] of [
        ["hostPort", m.hostPort],
        ["guestPort", m.guestPort],
      ] as const) {
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          throw new BootError(`portForward: ${label} must be an integer in 1..65535 (got ${port})`);
        }
      }
      if (seen.has(m.hostPort)) {
        throw new BootError(`portForward: duplicate hostPort ${m.hostPort}`);
      }
      seen.add(m.hostPort);
    }
  }

  const binaryInput = opts.binary ?? resolveVmmBinary();
  const binary = resolve(opts.cwd ?? process.cwd(), binaryInput);
  if (!existsSync(binary)) {
    throw new BootError(`VMM binary not found at ${binary}`);
  }

  // `image` and `cmd` are paired: image provides the rootfs to boot,
  // cmd is what runs inside it. Either both or neither. (Dummy-binary
  // boots for tests, and snapshot-only restores that rely on a baked
  // initramfs, both pass neither.)
  if (Boolean(opts.image) !== Boolean(opts.cmd)) {
    throw new BootError("boot: `image` and `cmd` must be specified together.");
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...opts.vmmEnv,
  };
  let diskAbs: string | undefined;
  if (opts.snapshot) {
    diskAbs = resolve(opts.cwd ?? process.cwd(), opts.snapshot);
    if (!existsSync(diskAbs)) {
      throw new BootError(`snapshot image not found: ${diskAbs}`);
    }
    env.MACHINEN_DISK = diskAbs;
  }
  if (opts.kernel) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.kernel);
    if (!existsSync(abs)) {
      throw new BootError(`kernel not found: ${abs}`);
    }
    env.MACHINEN_KERNEL = abs;
  }
  if (opts.dtb) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.dtb);
    if (!existsSync(abs)) {
      throw new BootError(`dtb not found: ${abs}`);
    }
    env.MACHINEN_DTB = abs;
  }

  // #94: always wire up a vsock UDS bridge so `vm.exec()` works out of
  // the box. Callers who set their own `MACHINEN_VSOCK` (e.g. the build
  // flow) win — we parse their spec to extract the UDS path for exec.
  let vsockUdsPath: string | undefined;
  let vsockTempDir: string | undefined;
  if (env.MACHINEN_VSOCK) {
    vsockUdsPath = parseVsockUdsPath(env.MACHINEN_VSOCK);
  } else {
    vsockTempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
    vsockUdsPath = join(vsockTempDir, "exec.sock");
    env.MACHINEN_VSOCK = `in:1978:${vsockUdsPath}`;
  }

  // gvproxy + artifact cache (#88) + host→guest port forwards (#87)
  // are set up together so the cache's port can be wired into the
  // guest env before packBundle seals the initramfs. If anything
  // downstream throws (packBundle validation, exposePort failure,
  // nodeSpawn failure), the outer catch shuts both supervisors back
  // down — otherwise a failed boot would leave orphans behind.
  let gvStop: (() => void) | undefined;
  let cacheStop: (() => Promise<void>) | undefined;
  let bundleTempDir: string | undefined;
  const mergedGuestEnv: Record<string, string> = { ...opts.env };

  try {
    if (!env.MACHINEN_NET_SOCKET) {
      const gvBin = resolveGvproxyBinary(binary);
      if (gvBin) {
        const gv = await spawnGvproxy(gvBin);
        env.MACHINEN_NET_SOCKET = gv.socketPath;
        gvStop = gv.stop;
        for (const m of portForward) {
          await exposePort(gv.controlSocketPath, m);
        }
      } else {
        if (portForward.length > 0) {
          throw new BootError(
            "portForward requires gvproxy, but no gvproxy binary was found. " +
              "Install gvproxy or point MACHINEN_GVPROXY at one.",
          );
        }
        warnGvproxyMissing();
      }
    }

    // Only useful when the guest has networking — without gvproxy
    // the guest can't reach the host loopback anyway. Caller-provided
    // FNM_NODE_DIST_MIRROR wins so tests and power users can point
    // fnm at a different mirror.
    if (env.MACHINEN_NET_SOCKET) {
      try {
        const cache = await spawnArtifactCache();
        cacheStop = cache.stop;
        if (!mergedGuestEnv.FNM_NODE_DIST_MIRROR) {
          // 192.168.127.254 is gvproxy's "host" mapping — it forwards
          // to the host's 127.0.0.1. (192.168.127.1 is the gateway,
          // not the host.) See scripts/bench-net.sh header for the
          // canonical description.
          mergedGuestEnv.FNM_NODE_DIST_MIRROR = `http://192.168.127.254:${cache.port}/node-dist`;
        }
      } catch (err) {
        process.stderr.write(
          `machinen: artifact cache failed to start (${err instanceof Error ? err.message : String(err)}) — continuing without it\n`,
        );
      }
    }

    if (opts.image || opts.cmd) {
      const packed = synthesizeAndPackBundle(opts, mergedGuestEnv);
      bundleTempDir = packed.tempDir;
      env.MACHINEN_INITRD = packed.cpioPath;
    }
  } catch (err) {
    if (cacheStop) {
      await cacheStop();
    }
    if (gvStop) {
      gvStop();
    }
    if (bundleTempDir) {
      try {
        rmSync(bundleTempDir, { recursive: true, force: true });
      } catch {}
    }
    if (vsockTempDir) {
      try {
        rmSync(vsockTempDir, { recursive: true, force: true });
      } catch {}
    }
    throw err;
  }

  const child = nodeSpawn(binary, opts.args ?? [], {
    cwd: opts.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  // #98: register the running VM so another process can attach. The
  // entry is keyed by an auto-generated id; optional name lets
  // `attach({ name })` look it up by something memorable.
  const id = newVmId();
  const vmName = opts.name;
  const childPid = child.pid ?? -1;
  let registered = false;
  if (childPid > 0 && vsockUdsPath) {
    try {
      writeEntry({
        id,
        name: vmName,
        pid: childPid,
        socketPath: vsockUdsPath,
        imagePath: opts.image ? resolve(opts.cwd ?? process.cwd(), opts.image) : undefined,
        startedAt: Date.now(),
      });
      registered = true;
    } catch {
      // Registry write is best-effort; attach won't find this VM but
      // local boot-and-use still works fine.
    }
  }

  child.once("exit", () => {
    if (bundleTempDir) {
      try {
        rmSync(bundleTempDir, { recursive: true, force: true });
      } catch {}
    }
    if (vsockTempDir) {
      try {
        rmSync(vsockTempDir, { recursive: true, force: true });
      } catch {}
    }
    if (gvStop) {
      gvStop();
    }
    if (cacheStop) {
      void cacheStop();
    }
    if (registered) {
      removeEntry(id);
    }
  });

  const timeoutMs = opts.timeoutMs === undefined ? 60_000 : opts.timeoutMs;

  // Start collecting stdout/stderr eagerly. Doing it lazily on the
  // first call to `.output()` / `.errorOutput()` loses data: the
  // streams can flush + close before the listener attaches, and more
  // importantly, the child backpressures if no one is reading (the
  // PL011 echo path writes a lot of bytes during kernel boot, enough
  // to fill a pipe buffer if nothing's draining it).
  const outputCollector = collect(child.stdout);
  const errorCollector = collect(child.stderr);

  const handle: VmHandle = {
    id,
    name: vmName,
    pid: childPid,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,

    async wait() {
      // If the child already exited before we got here, `once("exit")`
      // never fires — the event has already been emitted. Check first.
      if (child.exitCode !== null || child.signalCode !== null) {
        return { code: child.exitCode, signal: child.signalCode };
      }
      const settled = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
      const race =
        timeoutMs === null
          ? settled
          : Promise.race([
              settled,
              new Promise<never>((_, reject) => {
                setTimeout(
                  () => reject(new BootError(`VMM did not exit within ${timeoutMs}ms`)),
                  timeoutMs,
                ).unref();
              }),
            ]);
      const [code, signal] = await race;
      return { code, signal };
    },

    async kill() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      child.kill("SIGKILL");
      // Same race: the child may finish dying between the guard above
      // and the listener below. Re-check before waiting.
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      await once(child, "exit");
    },

    output: () => outputCollector,
    errorOutput: () => errorCollector,

    async detach() {
      // Drop the locally-booted process's hold without killing it:
      // unref stdio and unregister from the registry. The VMM keeps
      // running; `attach({ name | id })` from another process can
      // pick it back up via the vsock UDS, which is *not* cleaned up
      // on detach (only on VMM exit).
      child.stdin.end();
      child.unref();
      // Intentionally leave the registry entry in place — detach means
      // "someone else will attach," not "this VM is gone."
    },

    async exec(cmd, execOpts) {
      if (!vsockUdsPath) {
        throw new BootError(
          "vm.exec: no vsock UDS available — MACHINEN_VSOCK was set to an " +
            "unrecognized spec. Expected `in:<port>:<uds-path>`.",
        );
      }
      const res = await VsockExec.run(vsockUdsPath, cmd, execOpts);
      if (res.exitCode !== 0) {
        throw new BootError(
          `vm.exec failed (code ${res.exitCode}): ${cmd}\nstderr:\n${res.stderr}`,
        );
      }
      return res;
    },

    execRaw(cmd, execOpts) {
      if (!vsockUdsPath) {
        return Promise.reject(
          new BootError(
            "vm.execRaw: no vsock UDS available — MACHINEN_VSOCK was set to " +
              "an unrecognized spec. Expected `in:<port>:<uds-path>`.",
          ),
        );
      }
      return VsockExec.run(vsockUdsPath, cmd, execOpts);
    },

    async snapshot(outPath, snapshotOpts) {
      if (!diskAbs) {
        throw new BootError(
          "vm.snapshot: no disk was attached at boot. Pass `snapshot: '<path>'` to " +
            "boot() so CRIU has a target to write to.",
        );
      }
      const dumpCmd = snapshotOpts?.dumpCmd ?? "/sbin/machinen-dump";
      const deadlineMs = snapshotOpts?.timeoutMs ?? 90_000;
      const t0 = Date.now();

      // Trigger the in-guest dump. The vsock connection typically closes
      // mid-transaction as the guest powers off — all such close modes
      // are fine; `wait()` below is the real success signal.
      await this.execRaw(dumpCmd, { connectTimeoutMs: 2_000 }).catch(() => {});

      const killTimer = setTimeout(() => void this.kill(), deadlineMs);
      killTimer.unref();
      try {
        await this.wait();
      } finally {
        clearTimeout(killTimer);
      }
      const elapsedMs = Date.now() - t0;
      const consoleLog = await this.errorOutput();

      if (!consoleLog.includes("dump OK")) {
        throw new BootError(
          `vm.snapshot: guest did not report "dump OK" — check console log:\n${consoleLog.slice(-2000)}`,
        );
      }

      const outAbs = resolve(outPath);
      if (outAbs !== diskAbs) {
        copyFileSync(diskAbs, outAbs);
      }
      return { snapshotPath: outAbs, elapsedMs, consoleLog };
    },
  };

  return handle;
}

/**
 * Parse the UDS path out of a `MACHINEN_VSOCK` spec. Format is
 * `<direction>:<port>:<uds-path>` — we return the path portion so
 * `vm.exec()` knows where to dial. Returns undefined on unrecognized
 * shapes (caller-provided bespoke formats) so the handle can throw a
 * clear error if `.exec()` ends up called on it.
 */
function parseVsockUdsPath(spec: string): string | undefined {
  const match = spec.match(/^[^:]+:\d+:(.+)$/);
  return match ? match[1] : undefined;
}

export interface AttachOptions {
  /** Look up a VM by its registry id. One of `id` or `name` is required. */
  id?: string;
  /** Look up a VM by the name passed to `boot({ name })`. */
  name?: string;
}

/**
 * Reconnect to a running VM registered by an earlier `boot()` call
 * (possibly from a different process). Returns a `VmHandle` that can
 * `exec()`, `snapshot()`, and `kill()` the remote VM via the vsock
 * bridge the booter left behind.
 *
 * Attached handles have inert stream properties (`stdin`/`stdout`/
 * `stderr` are empty `PassThrough`s) — those belong to the original
 * booter. `output()`/`errorOutput()` resolve with the empty string.
 * `wait()` polls the pid rather than listening for `exit`.
 */
export async function attach(opts: AttachOptions): Promise<VmHandle> {
  const entry = findEntry(opts);
  if (!entry) {
    const q = opts.id ? `id ${opts.id}` : `name ${opts.name}`;
    throw new BootError(`attach: no running VM found for ${q}`);
  }
  const { PassThrough } = await import("node:stream");
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdout.end();
  stderr.end();

  const waitForExit = async (): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }> => {
    // Poll the pid at 200ms cadence. Rough, but adequate for a
    // rarely-hit path (usually attach is used for exec/snapshot, not
    // for waiting on termination).
    while (isAlive(entry.pid)) {
      await new Promise((r) => setTimeout(r, 200));
    }
    return { code: null, signal: null };
  };

  const handle: VmHandle = {
    id: entry.id,
    name: entry.name,
    pid: entry.pid,
    stdin,
    stdout,
    stderr,

    async wait() {
      return waitForExit();
    },

    async kill() {
      if (!isAlive(entry.pid)) {
        return;
      }
      try {
        process.kill(entry.pid, "SIGKILL");
      } catch {
        // Already dead.
      }
      await waitForExit();
    },

    async detach() {
      // No-op for attach handles — there's no local child to unref.
    },

    async output() {
      return "";
    },

    async errorOutput() {
      return "";
    },

    async exec(cmd, execOpts) {
      const res = await VsockExec.run(entry.socketPath, cmd, execOpts);
      if (res.exitCode !== 0) {
        throw new BootError(
          `vm.exec failed (code ${res.exitCode}): ${cmd}\nstderr:\n${res.stderr}`,
        );
      }
      return res;
    },

    execRaw(cmd, execOpts) {
      return VsockExec.run(entry.socketPath, cmd, execOpts);
    },

    async snapshot(outPath, snapshotOpts) {
      // Attach-snapshot: we don't know the disk path the VM was booted
      // with. Triggering a CRIU dump still works; the output is written
      // to /dev/vda inside the guest, but we have no way to copy it
      // from here. Snapshot-from-attach is deferred to a follow-up.
      throw new BootError(
        "vm.snapshot() is not supported on attached handles yet — snapshot " +
          "from the process that called boot(). Output path was: " +
          String(outPath) +
          (snapshotOpts ? " (opts ignored)" : ""),
      );
    },
  };
  return handle;
}

function synthesizeAndPackBundle(
  opts: BootOptions,
  mergedGuestEnv: Record<string, string>,
): { tempDir: string; cpioPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "machinen-bundle-"));
  const cpioPath = join(tempDir, "initramfs.cpio");
  const synthBundleDir = join(tempDir, "bundle");
  const cleanup = () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  };

  // Synthesize the bundle directory from `cmd` + guest-env. No
  // user-authored machinen-config.json; we generate it here and the
  // caller never sees it.
  mkdirSync(join(synthBundleDir, "rootfs"), { recursive: true });
  writeFileSync(
    join(synthBundleDir, "machinen-config.json"),
    JSON.stringify({
      cmd: opts.cmd,
      env: mergedGuestEnv,
    }),
  );

  let baseAbs: string | undefined;
  if (opts.image) {
    baseAbs = resolve(opts.cwd ?? process.cwd(), opts.image);
    if (!existsSync(baseAbs)) {
      cleanup();
      throw new BootError(`image tarball not found: ${baseAbs}`);
    }
  }

  let mount: { host: string; guest: string } | undefined;
  if (opts.mount) {
    try {
      validateMountGuest(opts.mount.guest);
    } catch (err) {
      cleanup();
      throw err;
    }
    const hostAbs = resolve(opts.cwd ?? process.cwd(), opts.mount.host);
    if (!existsSync(hostAbs)) {
      cleanup();
      throw new BootError(`mount host path not found: ${opts.mount.host}`);
    }
    if (!statSync(hostAbs).isDirectory()) {
      cleanup();
      throw new BootError(`mount host path must be a directory (got a file): ${opts.mount.host}`);
    }
    mount = { host: hostAbs, guest: normalizeMountGuest(opts.mount.guest) };
  }

  try {
    mkinitramfsPackBundle({
      bundle: synthBundleDir,
      out: cpioPath,
      base: baseAbs,
      mount,
      guestEnv: mergedGuestEnv,
    });
  } catch (err) {
    cleanup();
    const msg = err instanceof Error ? err.message : String(err);
    throw new BootError(`mkinitramfs pack failed: ${msg}`);
  }
  return { tempDir, cpioPath };
}

// The user-facing mount root. Guest paths must live under this prefix
// so mounts can never shadow the base rootfs or kernel filesystems.
const MOUNT_ROOT = "/mnt/";

function normalizeMountGuest(guest: string): string {
  return guest.replace(/\/+$/, "");
}

function validateMountGuest(guest: string): void {
  if (!guest || !guest.startsWith("/")) {
    throw new BootError(`mount guest path must be absolute: ${guest}`);
  }
  const trimmed = normalizeMountGuest(guest);
  if (!trimmed.startsWith(MOUNT_ROOT) || trimmed === MOUNT_ROOT.replace(/\/$/, "")) {
    throw new BootError(
      `mount guest path must live under ${MOUNT_ROOT} (got ${guest}) — ` +
        `pick a sub-path like ${MOUNT_ROOT}app`,
    );
  }
}

function collect(stream: Readable): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    stream.on("close", () => done(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", fail);
  });
}

// =============================================================
// Snapshots — #50 M2
// =============================================================
//
// A snapshot is "the serialized state of a warm process tree plus
// whatever filesystem state the warmup left behind." It lives as a
// single ext4 disk image the guest writes CRIU images into.
//
// Production path: `vm.snapshot(outPath)` on a running VM — the caller
// brings the VM to a warm state via `vm.exec()`, then snapshots it.
// Restore: `boot({ snapshot: <snapshot-path> })` on the next boot.

/**
 * Time-to-first-output-byte for a boot. Useful for measuring how
 * much the snapshot path is (or isn't) buying us.
 */
export function measureFirstByte(vm: VmHandle): Promise<number> {
  const started = Date.now();
  return new Promise((done, fail) => {
    vm.stderr.once("data", () => done(Date.now() - started));
    vm.stderr.once("error", fail);
  });
}
