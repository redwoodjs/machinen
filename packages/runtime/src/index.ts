export { Sandboxes, Supervisor } from "./multiplex.ts";
export type { SandboxEntry, OnOutputListener, SupervisorOptions } from "./multiplex.ts";
export { spawnPty } from "./pty.ts";
export type { PtySpawnOptions, PtyVmHandle } from "./pty.ts";
export { VsockWinsize } from "./winsize.ts";
export type { VsockWinsizeOptions } from "./winsize.ts";
export { VsockSecrets } from "./secrets.ts";
export type { VsockSecretsOptions } from "./secrets.ts";
export { VsockFiles } from "./files.ts";
export type { VsockFilesOptions } from "./files.ts";
export { VsockExec } from "./exec.ts";
export type { VsockExecOptions, VsockExecResult } from "./exec.ts";
export {
  packBundle as mkinitramfsBundle,
  packRootfs as mkinitramfsRootfs,
  packWorkspace as mkinitramfsWorkspace,
  packMinimal as mkinitramfsMinimal,
  cli as mkinitramfsCli,
} from "./mkinitramfs.ts";

// @machinen/runtime — TypeScript surface for spawning microVMs.
//
// The Zig VMM is a separate binary (today: the test binary produced
// by `zig build test` in packages/microvm). This package wraps it so
// application code can say:
//
//   const vm = await spawn({ binary, env: { MACHINEN_BOOT_TEST: "1" } });
//   vm.stdin.write("process.version\n.exit\n");
//   const out = await vm.output();
//   await vm.wait();
//
// #50 M2 adds snapshot-aware spawn on top:
//
//   await buildSnapshot({ binary, diskPath: "./warm.img", ... });
//   const vm = await spawn({ binary, disk: "./warm.img" });
//   // vm is now running a process that was frozen in a previous VMM.
//
// No multiplexing yet — one VM per handle (#51 is its own issue).

import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, statSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, platform as osPlatform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import { packBundle as mkinitramfsPackBundle } from "./mkinitramfs.ts";

export class SpawnError extends Error {}

const require_ = createRequire(import.meta.url);

/**
 * Locate the VMM binary using the same lookup order as `@machinen/cli`:
 *   1. `MACHINEN_VMM` env var (dev-mode override)
 *   2. `require.resolve("@machinen/vmm-<arch>-<os>")` → `binary` export
 *
 * Callers can pass an explicit `binary` to `spawn()` to bypass this.
 */
export function resolveVmmBinary(): string {
  const envOverride = process.env.MACHINEN_VMM;
  if (envOverride) {
    const abs = resolve(envOverride);
    if (!existsSync(abs)) {
      throw new SpawnError(`MACHINEN_VMM is set to ${envOverride}, but that file does not exist.`);
    }
    return abs;
  }

  const key = `${osArch()}-${osPlatform()}`;
  const pkgName = `@machinen/vmm-${key}`;
  try {
    const mod = require_(pkgName) as { binary: string };
    if (!mod.binary || !existsSync(mod.binary)) {
      throw new SpawnError(`${pkgName} is installed but its binary is missing at ${mod.binary}.`);
    }
    return mod.binary;
  } catch (err) {
    if (err instanceof SpawnError) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new SpawnError(
      `No VMM binary found for ${key}.\n` +
        `  Expected package: ${pkgName}\n` +
        `  Install: npm i ${pkgName}   (or npm i -g @machinen/cli)\n` +
        `  Error: ${msg}`,
    );
  }
}

export interface SpawnOptions {
  /**
   * Absolute or cwd-relative path to the built VMM binary. Optional —
   * if omitted, spawn() resolves it via `resolveVmmBinary()` (MACHINEN_VMM
   * env override, falling back to the platform-matched
   * `@machinen/vmm-<arch>-<os>` package).
   */
  binary?: string;
  /** Extra env vars passed to the guest wrapper (not into the guest itself). */
  env?: Record<string, string>;
  /** Working directory for the VMM (for finding fixture files). */
  cwd?: string;
  /** Extra argv for the VMM. */
  args?: string[];
  /**
   * Milliseconds to wait in `wait()` before giving up and rejecting.
   * Defaults to 60s. Pass `null` to wait forever.
   */
  timeoutMs?: number | null;
  /**
   * Attach this host file as `/dev/vda` inside the guest. Same thing
   * as setting `MACHINEN_DISK` in `env`; this is just the named
   * shortcut. See #47 (virtio-blk) and #50 (snapshot-from-disk).
   */
  disk?: string;
  /** Path to the guest kernel Image. Forwarded as `MACHINEN_KERNEL`. */
  kernel?: string;
  /** Path to the guest device-tree blob. Forwarded as `MACHINEN_DTB`. */
  dtb?: string;
  /**
   * Path to a bundle directory: `<bundle>/rootfs/` + `<bundle>/machinen-config.json`.
   * When set, the runtime packs the bundle into a cpio initramfs and
   * points the VMM at it via `MACHINEN_INITRD`.
   */
  bundle?: string;
  /**
   * Optional path to the base rootfs tarball (e.g. the one shipped in
   * GitHub Releases as `rootfs-debian-arm64.tar.gz`). When provided with
   * `bundle`, the runtime extracts the tarball and overlays
   * `<bundle>/rootfs/` on top before packing the cpio. When omitted,
   * `<bundle>/rootfs/` is treated as a standalone rootfs.
   */
  baseRootfs?: string;
  /**
   * A single host directory copied into the guest at boot, between the
   * base rootfs and the bundle's `rootfs/` overlay. The guest path must
   * live under `/mnt/`. Bundle files win on path collisions.
   *
   * Copy-once, scratch-layer semantics: guest writes are discarded when
   * the VM exits; the host directory on disk is never modified. See
   * #64. Live-share follow-up: #78.
   */
  mount?: { host: string; guest: string };
}

export interface VmHandle {
  readonly pid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;

  /** Resolves when the VM process exits. Rejects on timeout. */
  wait(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

  /** Send SIGKILL to the VM. Resolves once it's really gone. */
  kill(): Promise<void>;

  /** Buffer stdout until the process exits; return it as a UTF-8 string. */
  output(): Promise<string>;

  /** Same as `output()` but for stderr (where guest console lands). */
  errorOutput(): Promise<string>;
}

export async function spawn(opts: SpawnOptions = {}): Promise<VmHandle> {
  const binaryInput = opts.binary ?? resolveVmmBinary();
  const binary = resolve(opts.cwd ?? process.cwd(), binaryInput);
  if (!existsSync(binary)) {
    throw new SpawnError(`VMM binary not found at ${binary}`);
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...opts.env,
  };
  if (opts.disk) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.disk);
    if (!existsSync(abs)) {
      throw new SpawnError(`disk image not found: ${abs}`);
    }
    env.MACHINEN_DISK = abs;
  }
  if (opts.kernel) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.kernel);
    if (!existsSync(abs)) {
      throw new SpawnError(`kernel not found: ${abs}`);
    }
    env.MACHINEN_KERNEL = abs;
  }
  if (opts.dtb) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.dtb);
    if (!existsSync(abs)) {
      throw new SpawnError(`dtb not found: ${abs}`);
    }
    env.MACHINEN_DTB = abs;
  }

  let bundleTempDir: string | undefined;
  if (opts.bundle) {
    const packed = packBundle(opts);
    bundleTempDir = packed.tempDir;
    env.MACHINEN_INITRD = packed.cpioPath;
  }

  const child = nodeSpawn(binary, opts.args ?? [], {
    cwd: opts.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  if (bundleTempDir) {
    child.once("exit", () => {
      try {
        rmSync(bundleTempDir, { recursive: true, force: true });
      } catch {}
    });
  }

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
    pid: child.pid ?? -1,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,

    async wait() {
      const settled = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
      const race =
        timeoutMs === null
          ? settled
          : Promise.race([
              settled,
              new Promise<never>((_, reject) => {
                setTimeout(
                  () => reject(new SpawnError(`VMM did not exit within ${timeoutMs}ms`)),
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
      await once(child, "exit");
    },

    output: () => outputCollector,
    errorOutput: () => errorCollector,
  };

  return handle;
}

function packBundle(opts: SpawnOptions): { tempDir: string; cpioPath: string } {
  const bundleDir = resolve(opts.cwd ?? process.cwd(), opts.bundle!);
  if (!existsSync(bundleDir) || !statSync(bundleDir).isDirectory()) {
    throw new SpawnError(`bundle directory not found: ${bundleDir}`);
  }
  if (!existsSync(join(bundleDir, "rootfs"))) {
    throw new SpawnError(`bundle missing rootfs/: ${bundleDir}`);
  }
  if (!existsSync(join(bundleDir, "machinen-config.json"))) {
    throw new SpawnError(`bundle missing machinen-config.json: ${bundleDir}`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), "machinen-bundle-"));
  const cpioPath = join(tempDir, "initramfs.cpio");
  const cleanup = () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  };

  let baseAbs: string | undefined;
  if (opts.baseRootfs) {
    baseAbs = resolve(opts.cwd ?? process.cwd(), opts.baseRootfs);
    if (!existsSync(baseAbs)) {
      cleanup();
      throw new SpawnError(`base rootfs tarball not found: ${baseAbs}`);
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
      throw new SpawnError(`mount host path not found: ${opts.mount.host}`);
    }
    if (!statSync(hostAbs).isDirectory()) {
      cleanup();
      throw new SpawnError(`mount host path must be a directory (got a file): ${opts.mount.host}`);
    }
    mount = { host: hostAbs, guest: normalizeMountGuest(opts.mount.guest) };
  }

  try {
    mkinitramfsPackBundle({ bundle: bundleDir, out: cpioPath, base: baseAbs, mount });
  } catch (err) {
    cleanup();
    const msg = err instanceof Error ? err.message : String(err);
    throw new SpawnError(`mkinitramfs --bundle failed: ${msg}`);
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
    throw new SpawnError(`mount guest path must be absolute: ${guest}`);
  }
  const trimmed = normalizeMountGuest(guest);
  if (!trimmed.startsWith(MOUNT_ROOT) || trimmed === MOUNT_ROOT.replace(/\/$/, "")) {
    throw new SpawnError(
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
// single ext4 disk image that the guest:
//
//   - formats and writes CRIU images into during the warmup boot, and
//   - mounts and restores from during every spawn boot.
//
// The runtime's job here is the orchestration around that image:
// create it, boot the VMM pointing at it, watch for the warmup to
// finish, then hand the same image off to `spawn({ disk: ... })`
// for as many restores as the caller wants.

export interface BuildSnapshotOptions extends SpawnOptions {
  /** Output file for the snapshot image. Created if missing. */
  diskPath: string;
  /** Size of the blank disk to create (bytes). Default 128 MiB. */
  diskSizeBytes?: number;
  /**
   * Wall-clock ceiling for the warmup run. If the VMM doesn't exit
   * cleanly in this window we SIGKILL it and fail. Default 90s.
   */
  timeoutMs?: number;
}

export interface SnapshotResult {
  diskPath: string;
  /** Time from process.spawn to VMM exit, in milliseconds. */
  elapsedMs: number;
  /** Guest console output captured during the warmup run. */
  consoleLog: string;
}

/**
 * Prepare a snapshot image by booting the VMM in "warmup" mode.
 *
 * The caller is responsible for providing a binary + initramfs whose
 * /machinen-config.json points at a warmup entry (`spawn-warmup.sh`
 * in the microvm package's test-fixtures/assets is the reference). This
 * function just:
 *
 *   1. Creates `diskPath` as a blank `diskSizeBytes`-byte file.
 *   2. Launches the VMM with MACHINEN_DISK pointing at that file.
 *   3. Waits for the VMM to exit (the guest triggers this via PSCI
 *      SYSTEM_OFF once CRIU dump is done).
 *   4. Returns the path + stats.
 */
export async function buildSnapshot(opts: BuildSnapshotOptions): Promise<SnapshotResult> {
  const diskPath = resolve(opts.cwd ?? process.cwd(), opts.diskPath);
  const size = opts.diskSizeBytes ?? 128 * 1024 * 1024;

  // Allocate the empty disk file.
  const fd = openSync(diskPath, "w");
  try {
    // Writing a single zero byte at size-1 sparsely extends the file.
    const buf = Buffer.alloc(1);
    writeSync(fd, buf, 0, 1, size - 1);
  } finally {
    closeSync(fd);
  }

  const t0 = Date.now();
  const vm = await spawn({
    ...opts,
    disk: diskPath,
    timeoutMs: opts.timeoutMs ?? null,
  });
  // Cap runtime outside of wait() so we can still kill and surface
  // whatever console output we got.
  const deadlineMs = opts.timeoutMs ?? 90_000;
  const kill = setTimeout(() => void vm.kill(), deadlineMs);
  kill.unref();
  try {
    await vm.wait();
  } finally {
    clearTimeout(kill);
  }
  const elapsedMs = Date.now() - t0;
  const consoleLog = await vm.errorOutput();

  if (!consoleLog.includes("dump OK")) {
    throw new SpawnError(
      `warmup never reported "dump OK" — check console log:\n${consoleLog.slice(-2000)}`,
    );
  }
  return { diskPath, elapsedMs, consoleLog };
}

/**
 * Time-to-first-output-byte for a spawn. Useful for measuring how
 * much the snapshot path is (or isn't) buying us.
 */
export function measureFirstByte(vm: VmHandle): Promise<number> {
  const started = Date.now();
  return new Promise((done, fail) => {
    vm.stderr.once("data", () => done(Date.now() - started));
    vm.stderr.once("error", fail);
  });
}
