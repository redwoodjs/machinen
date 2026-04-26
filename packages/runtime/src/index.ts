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
export type { LogEvent, OnLog } from "./log.ts";
export { provision, resolveBaseRootfs } from "./provision.ts";
export type { ProvisionOptions, ProvisionResult } from "./provision.ts";
export { ensureRootfsImage, rootfsImgCacheDir } from "./rootfs-img.ts";
export type { EnsureRootfsImageOptions } from "./rootfs-img.ts";
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
export type {
  PackBundleOptions,
  PackRootfsOptions,
  PackMinimalOptions,
  PackWorkspaceOptions,
} from "./mkinitramfs.ts";
export {
  MachinenError,
  BootError,
  ExecError,
  SnapshotError,
  ProvisionError,
  RegistryError,
  FilesError,
  MountError,
  SecretsError,
  WinsizeError,
  SandboxError,
  CacheError,
  GvproxyError,
  MkinitramfsError,
  ParseError,
  ErrorCode,
  isMachinenError,
  formatMachinenError,
} from "./errors.ts";
export type { MachinenErrorOptions } from "./errors.ts";

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

import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn as nodeSpawn,
} from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, platform as osPlatform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Readable, Writable } from "node:stream";
import debugLib from "debug";
import { defaultFuseAgentPath, packBundle as mkinitramfsPackBundle } from "./mkinitramfs.ts";
import { ensureGvproxy, exposePort, spawnGvproxy, warnGvproxyMissing } from "./gvproxy.ts";
import { spawnArtifactCache } from "./artifact-cache.ts";
import { BootError, ExecError, RegistryError, SnapshotError } from "./errors.ts";
import { ensureRootfsImage } from "./rootfs-img.ts";
import { VsockExec, type VsockExecOptions, type VsockExecResult } from "./exec.ts";
import { serveLiveMount } from "./mount-server.ts";
import type { OnLog } from "./log.ts";
import { claimName, findEntry, isAlive, removeEntry, writeEntry } from "./registry.ts";

const debug = debugLib("machinen:boot");
const debugAttach = debugLib("machinen:attach");
const debugSnapshot = debugLib("machinen:snapshot");
const vmmDebug = debugLib("machinen:vmm");

const require_ = createRequire(import.meta.url);

/**
 * Locate the VMM binary using the same lookup order as `@machinen/cli`:
 *   1. `MACHINEN_VMM` env var (dev-mode override)
 *   2. `require.resolve("@machinen/vmm-<arch>-<os>")` → `binary` export
 *
 * Callers can pass an explicit `binary` to `boot()` to bypass this.
 *
 * @throws {BootError} BOOT_VMM_MISSING | BOOT_VMM_PACKAGE_BROKEN
 */
export function resolveVmmBinary(): string {
  const envOverride = process.env.MACHINEN_VMM;
  if (envOverride) {
    const abs = resolve(envOverride);
    if (!existsSync(abs)) {
      throw new BootError(
        "BOOT_VMM_MISSING",
        `MACHINEN_VMM is set to ${envOverride}, but that file does not exist.`,
      );
    }
    return abs;
  }

  const key = `${osArch()}-${osPlatform()}`;
  const pkgName = `@machinen/vmm-${key}`;
  try {
    const mod = require_(pkgName) as { binary: string };
    if (!mod.binary || !existsSync(mod.binary)) {
      throw new BootError(
        "BOOT_VMM_PACKAGE_BROKEN",
        `${pkgName} is installed but its binary is missing at ${mod.binary}.`,
      );
    }
    return mod.binary;
  } catch (err) {
    if (err instanceof BootError) {
      throw err;
    }
    throw new BootError(
      "BOOT_VMM_MISSING",
      `No VMM binary found for ${key}.\n` +
        `  Expected package: ${pkgName}\n` +
        `  Install: npm i ${pkgName}   (or npm i -g @machinen/cli)`,
      { cause: err },
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
   * Attach this host file as the scratch virtio-blk device — `/dev/vdb`
   * inside the guest when `rootDisk` is also set, or `/dev/vda` when
   * only this disk is attached (legacy / pre-#114 layout). Typically a
   * CRIU snapshot image produced by `vm.snapshot()`, for a sub-second
   * restore on boot. See #47 (virtio-blk) and #50.
   */
  snapshot?: string;
  /**
   * Boot the guest with the rootfs on a virtio-blk device (`/dev/vda`)
   * instead of inflating the whole rootfs into a RAM-backed tmpfs via
   * the initramfs. See #114.
   *
   * Default: `true` whenever `image` is set. The runtime materializes
   * an ext4 image from `image` (cached at
   * `~/.cache/machinen/rootfs/<sha256>.img`) and attaches it as the
   * rootdisk; the guest's `/init` mounts + chroots into it before
   * running the user cmd. Materialization needs `mke2fs` (or
   * `mkfs.ext4`) on PATH — `brew install e2fsprogs` on macOS, the
   * `e2fsprogs` package on Linux.
   *
   *   - `string` — path to a pre-built ext4 `.img` file to attach
   *                directly. Skips the materialize step + cache.
   *   - `false`  — opt out: keep the cpio-as-rootfs path. The whole
   *                rootfs lands in a tmpfs at boot (RAM scales ~8×
   *                with rootfs size). Mostly an escape hatch for
   *                tooling that doesn't need disk-backed semantics
   *                (e.g. `provision()` itself).
   */
  rootDisk?: boolean | string;
  /**
   * Optional name to register this VM under (`attach({ name })`
   * lookup key). Path-shaped strings ("worker/9012") are allowed.
   * Names are unique while live — `boot()` throws
   * `REGISTRY_NAME_IN_USE` if another VM already holds the name.
   */
  name?: string;
  /**
   * Bookkeeping: absolute path to the snapshot bundle this VM was
   * forked from. Set by `restore({ snapDir })`; visible in
   * `machinen ls`. Plain `boot()` leaves it undefined.
   */
  forkedFrom?: string;
  /**
   * A single host directory copied into the guest at boot. The guest
   * path must live under `/mnt/`. Copy-once semantics: guest writes are
   * discarded when the VM exits. See #64, #78.
   *
   * The payload rides through the initramfs cpio (overlaid under
   * `/mnt/<guest>/` at pack time) and is then carried across the
   * rootdisk pivot by `/init` into the on-disk rootfs. With
   * `rootDisk: true` (the default) the mount briefly counts against
   * the initramfs RAM ceiling at unpack — the same ceiling #114 was
   * designed to relieve for the rootfs proper. For very large mounts
   * prefer `liveMount` (FUSE pass-through, no copy). See #125.
   */
  mount?: { host: string; guest: string };
  /**
   * Host directories exposed to the guest as live-share FUSE mounts
   * (#78). Unlike `mount` (copy-once into the boot rootfs), these stay
   * connected to the host: the guest reads on demand via a vsock FUSE
   * relay, and nothing is copied at boot. Read-only in this build;
   * `:rw` write-through is a follow-up.
   *
   * Each guest path must live under `/mnt/` (same rule as `mount`).
   * Repeatable; each entry gets its own vsock port.
   *
   * Security note: a live-share mount gives a compromised guest a
   * persistent channel back to the host filesystem. Containment keeps
   * that bounded to the configured host root. `mount` (copy-once) has
   * no such runtime channel and is strictly safer — prefer it for
   * inputs you don't need write-through on.
   */
  liveMounts?: Array<{ host: string; guest: string }>;
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
   * Streaming log callback — fires for every byte of guest output:
   * kernel console (VMM stderr) and every exec invocation made through
   * the returned handle. See `LogEvent.source` to tell them apart. See
   * #83. For per-call output-only tees on a single exec, use
   * `vm.exec({ onStdout, onStderr })` instead.
   */
  onLog?: OnLog;
}

export interface VmHandle {
  /**
   * PID of the host-side VMM process — primary identifier across
   * boot/attach. Kernel-unique while alive; reused after exit, so
   * pass it to `attach({ pid })` while the VM is live (or use
   * `--name` for a stable handle).
   */
  readonly pid: number;
  /** Optional human-friendly name passed to `boot({ name })`. */
  readonly name?: string;
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
   * Write `contents` to `guestPath` inside the VM. Convenience over
   * `vm.exec(...)` for the common "drop a config file from the host"
   * case — no quoting/heredoc gymnastics, binary-safe via base64.
   *
   * Parent directories are created by default (`recursive: true`).
   * Pass `mode` to set the file mode (octal, e.g. `0o755`).
   * Pass `append: true` to append instead of overwrite.
   *
   * Best for small-to-medium files (configs, scripts) — the contents
   * ride through a single vsock exec frame, so very large blobs are
   * better handled with `--mount` / `VsockFiles.push`.
   *
   * Throws `ExecError` (`EXEC_NONZERO_EXIT`) if the underlying shell
   * write fails (e.g. permissions, full disk, missing `base64`).
   *
   * @throws {ExecError} EXEC_VSOCK_UNAVAILABLE | EXEC_NONZERO_EXIT |
   *   EXEC_AGENT_UNAVAILABLE (retryable) | EXEC_AGENT_TIMEOUT (retryable)
   */
  writeFile(guestPath: string, contents: Buffer | string, opts?: WriteFileOptions): Promise<void>;

  /**
   * Freeze this VM with CRIU and write a snapshot bundle into
   * `opts.outDir`. The bundle is a directory containing:
   *
   *   <outDir>/disk.img      ← CRIU image set on an ext4 volume
   *   <outDir>/meta.json     ← source name + timestamp
   *
   * The caller must have booted the VM with `snapshot: '<scratch>'`
   * so the guest had a /dev/vda to dump into; otherwise this throws
   * `SNAPSHOT_NO_DISK`.
   *
   * Guest contract: the rootfs ships a dump helper callable via
   * vsock exec — default `/sbin/machinen-dump`, override via
   * `opts.dumpCmd`. The helper runs `criu dump` against the
   * workload tree, syncs the ext4 images, and lets
   * `/sbin/machinen-supervisor` trigger PSCI SYSTEM_OFF. Success is
   * signalled by a clean VMM exit before `opts.timeoutMs` elapses
   * plus an mtime bump on the disk file — timer expiration throws
   * `SNAPSHOT_TIMEOUT`; an untouched disk throws
   * `SNAPSHOT_DUMP_FAILED`.
   *
   * Supported on both boot-owned and attach handles — attach uses
   * the `diskPath` stored in the VM registry entry at boot time.
   *
   * The VM exits as part of the dump. To continue using the VM
   * afterwards, restore from the produced snapshot bundle.
   */
  snapshot(opts: SnapshotOptions): Promise<SnapshotResult>;
}

export interface WriteFileOptions {
  /** Octal mode for the destination file (e.g. `0o755`). Default: leave as-is. */
  mode?: number;
  /** `mkdir -p` the parent directory before writing. Default: true. */
  recursive?: boolean;
  /** Append to the file instead of overwriting. Default: false. */
  append?: boolean;
}

export interface SnapshotOptions {
  /**
   * Directory the snapshot bundle is written to. Created if missing
   * and required to be empty (or absent) so a previous snapshot
   * can't be silently overwritten.
   */
  outDir: string;
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
  /**
   * Streaming log callback — fires for every byte the dump emits
   * (guest console + the dump exec). See #83. When both the snapshot
   * call and `boot({ onLog })` have a callback set, both fire.
   */
  onLog?: OnLog;
}

export interface SnapshotResult {
  /** Absolute path to the snapshot bundle directory. */
  snapDir: string;
  /** Absolute path to the disk image inside the bundle. */
  diskPath: string;
  /** Time from `snapshot()` entry to VMM exit, in milliseconds. */
  elapsedMs: number;
  /** Guest console output captured during the dump. */
  consoleLog: string;
}

/**
 * On-disk shape of the bundle's `meta.json`. Read by `restore()`
 * to reconstruct the source VM's name when registering the fork.
 */
export interface SnapshotMeta {
  /** Name passed to `boot({ name })` when the source VM was started. */
  sourceName?: string;
  /** ms epoch when `vm.snapshot()` returned. */
  snappedAt: number;
}

/**
 * Boot a microVM and return a handle to interact with it.
 *
 * @throws {BootError} BOOT_VMM_MISSING | BOOT_VMM_PACKAGE_BROKEN |
 *   BOOT_IMAGE_NOT_FOUND | BOOT_SNAPSHOT_NOT_FOUND |
 *   BOOT_KERNEL_NOT_FOUND | BOOT_DTB_NOT_FOUND |
 *   BOOT_CMD_WITHOUT_IMAGE | BOOT_CMD_MISSING |
 *   BOOT_MOUNT_INVALID | BOOT_MOUNT_HOST_NOT_FOUND |
 *   BOOT_PORT_FORWARD_INVALID | BOOT_PORT_FORWARD_CONFLICT |
 *   BOOT_PORT_FORWARD_NO_GVPROXY | BOOT_PACK_FAILED
 */
export async function boot(opts: BootOptions = {}): Promise<VmHandle> {
  const bootT0 = Date.now();
  debug(
    "boot entry image=%s cmd=%j name=%s portForward=%d hasSnapshot=%s mount=%s",
    opts.image ?? "<none>",
    opts.cmd ?? null,
    opts.name ?? "<unset>",
    (opts.portForward ?? []).length,
    Boolean(opts.snapshot),
    opts.mount ? `${opts.mount.host}->${opts.mount.guest}` : "<none>",
  );
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
        "BOOT_PORT_FORWARD_INVALID",
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
          throw new BootError(
            "BOOT_PORT_FORWARD_INVALID",
            `portForward: ${label} must be an integer in 1..65535 (got ${port})`,
          );
        }
      }
      if (seen.has(m.hostPort)) {
        throw new BootError(
          "BOOT_PORT_FORWARD_CONFLICT",
          `portForward: duplicate hostPort ${m.hostPort}`,
        );
      }
      seen.add(m.hostPort);
    }
  }

  const binaryInput = opts.binary ?? resolveVmmBinary();
  const binary = resolve(opts.cwd ?? process.cwd(), binaryInput);
  if (!existsSync(binary)) {
    throw new BootError("BOOT_VMM_MISSING", `VMM binary not found at ${binary}`);
  }

  // `cmd` requires an image to run against. `image` alone is allowed
  // — the image may carry a baked-in default cmd (see
  // `provision({ cmd })`); if it doesn't and the user didn't pass
  // one, `synthesizeAndPackBundle` errors with a clear message.
  if (opts.cmd && !opts.image) {
    throw new BootError("BOOT_CMD_WITHOUT_IMAGE", "boot: `image` is required when `cmd` is set.");
  }

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...opts.vmmEnv,
  };
  let diskAbs: string | undefined;
  if (opts.snapshot) {
    diskAbs = resolve(opts.cwd ?? process.cwd(), opts.snapshot);
    if (!existsSync(diskAbs)) {
      throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", `snapshot image not found: ${diskAbs}`);
    }
    env.MACHINEN_DISK = diskAbs;
  }

  // #114: rootdisk-by-default. Boot mounts the rootfs from a
  // virtio-blk device (/dev/vda) instead of inflating the whole tree
  // into a RAM-backed tmpfs at boot. The user passes `rootDisk: false`
  // to opt back into the legacy cpio-as-rootfs path (mostly used by
  // `provision()` itself, which writes its scratch tar to /dev/vda).
  // Resolution + materialization happens later, alongside packBundle,
  // so per-arg validation (mount paths, liveMount, baked-cmd) fires
  // before we spend time hashing the tarball.
  const wantsRootDisk = opts.rootDisk !== false && (opts.rootDisk !== undefined || !!opts.image);
  if (wantsRootDisk && typeof opts.rootDisk !== "string" && !opts.image) {
    throw new BootError(
      "BOOT_CMD_WITHOUT_IMAGE",
      "boot: rootDisk: true requires an `image` (the .tar.gz to materialize).",
    );
  }
  if (opts.kernel) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.kernel);
    if (!existsSync(abs)) {
      throw new BootError("BOOT_KERNEL_NOT_FOUND", `kernel not found: ${abs}`);
    }
    env.MACHINEN_KERNEL = abs;
  }
  if (opts.dtb) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.dtb);
    if (!existsSync(abs)) {
      throw new BootError("BOOT_DTB_NOT_FOUND", `dtb not found: ${abs}`);
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
    debug(
      "vsock spec from caller env: %s (uds=%s)",
      env.MACHINEN_VSOCK,
      vsockUdsPath ?? "<unparsed>",
    );
  } else {
    vsockTempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
    vsockUdsPath = join(vsockTempDir, "exec.sock");
    env.MACHINEN_VSOCK = `in:1978:${vsockUdsPath}`;
    debug("vsock auto uds=%s", vsockUdsPath);
  }

  // #78: resolve live-share mounts. Each gets a fresh vsock port (base
  // 1970, the band below the exec/file/secrets/winsize agents) and a
  // UDS per mount so the VMM's MACHINEN_VSOCK spec can include one
  // entry per mount. We compute these here so the port↔guest pairs can
  // be baked into machinen-config.json at pack time — the guest's
  // /init reads the same pairs and forks the FUSE agent per entry.
  let liveMountsResolved: ResolvedLiveMount[] = [];
  if ((opts.liveMounts ?? []).length > 0) {
    if (!vsockTempDir) {
      vsockTempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
    }
    liveMountsResolved = resolveLiveMounts(opts.liveMounts!, opts.cwd, vsockTempDir);
    for (const lm of liveMountsResolved) {
      env.MACHINEN_VSOCK = `${env.MACHINEN_VSOCK},in:${lm.port}:${lm.udsPath}`;
    }
  }

  // gvproxy + artifact cache (#88) + host→guest port forwards (#87)
  // are set up together so the cache's port can be wired into the
  // guest env before packBundle seals the initramfs. If anything
  // downstream throws (packBundle validation, exposePort failure,
  // nodeSpawn failure), the outer catch shuts both supervisors back
  // down — otherwise a failed boot would leave orphans behind.
  let gvStop: (() => void) | undefined;
  let cacheStop: (() => Promise<void>) | undefined;
  const liveMountStops: Array<() => Promise<void>> = [];
  let bundleTempDir: string | undefined;
  const mergedGuestEnv: Record<string, string> = { ...opts.env };

  try {
    if (!env.MACHINEN_NET_SOCKET) {
      // Auto-install gvproxy on first use if not already resolvable —
      // visible stderr line; cached under ~/.machinen so subsequent
      // boots are silent. See #83 follow-up.
      const gvBin = await ensureGvproxy(binary);
      if (gvBin) {
        debug("starting gvproxy bin=%s", gvBin);
        const gv = await spawnGvproxy(gvBin);
        env.MACHINEN_NET_SOCKET = gv.socketPath;
        gvStop = gv.stop;
        for (const m of portForward) {
          await exposePort(gv.controlSocketPath, m);
        }
      } else {
        if (portForward.length > 0) {
          throw new BootError(
            "BOOT_PORT_FORWARD_NO_GVPROXY",
            "portForward requires gvproxy, but no gvproxy binary was found. " +
              "Install gvproxy or point MACHINEN_GVPROXY at one.",
          );
        }
        debug("gvproxy not found — booting without networking");
        warnGvproxyMissing();
      }
    } else {
      debug("MACHINEN_NET_SOCKET already set — skipping gvproxy spawn");
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

    // #78: start one live-share server per resolved mount before the
    // VMM boots. The guest fuse-agent will dial these UDSes once it's
    // past /dev/fuse mount; if we started them after the VMM, the
    // agent would spin in connect-retry for as long as we took.
    for (const lm of liveMountsResolved) {
      const handle = await serveLiveMount(lm.udsPath, { rootAbs: lm.host });
      liveMountStops.push(handle.stop);
    }

    // Pack an initramfs whenever the guest needs userspace (image +
    // cmd + snapshot-only restore all need /init + synthesized
    // machinen-config.json). Test-mode zig boots fall through with no
    // INITRD env set — the VMM uses its own fixture initramfs.
    if (opts.image || opts.cmd || opts.snapshot) {
      const packT0 = Date.now();
      const packed = synthesizeAndPackBundle(opts, mergedGuestEnv, liveMountsResolved);
      bundleTempDir = packed.tempDir;
      env.MACHINEN_INITRD = packed.cpioPath;
      debug("initramfs packed cpio=%s elapsed=%dms", packed.cpioPath, Date.now() - packT0);
    }

    // #114: rootDisk materialization. After all input validation has
    // passed (so a bad mount path or missing image fails before we
    // hash a multi-GB tarball). On a cache hit this is a few ms.
    if (wantsRootDisk) {
      let rootDiskAbs: string;
      if (typeof opts.rootDisk === "string") {
        rootDiskAbs = resolve(opts.cwd ?? process.cwd(), opts.rootDisk);
        if (!existsSync(rootDiskAbs)) {
          throw new BootError("BOOT_IMAGE_NOT_FOUND", `rootDisk image not found: ${rootDiskAbs}`);
        }
      } else {
        const baseAbs = resolve(opts.cwd ?? process.cwd(), opts.image!);
        rootDiskAbs = ensureRootfsImage(baseAbs);
      }
      env.MACHINEN_ROOTDISK = rootDiskAbs;
    }
  } catch (err) {
    for (const stop of liveMountStops) {
      await stop().catch(() => {});
    }
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
  debug(
    "VMM spawned pid=%d binary=%s elapsedSinceEntry=%dms",
    child.pid ?? -1,
    binary,
    Date.now() - bootT0,
  );

  // #98: register the running VM so another process can attach. The
  // entry is keyed by pid (kernel-unique while alive); optional name
  // lets `attach({ name })` look it up by something memorable.
  //
  // Name claim is authoritative — `claimName` uses O_EXCL on the
  // pin file, so a concurrent boot of the same name loses the race
  // and we throw REGISTRY_NAME_IN_USE. The just-spawned VMM has to
  // be torn down on conflict; otherwise it'd be an orphan no one
  // can reach.
  const vmName = opts.name;
  const childPid = child.pid ?? -1;
  if (vmName && childPid > 0) {
    if (!claimName(vmName, childPid)) {
      try {
        child.kill("SIGKILL");
      } catch {}
      throw new RegistryError(
        "REGISTRY_NAME_IN_USE",
        `boot: name '${vmName}' is already held by another live VM. ` +
          `Pick a different --name or kill the existing VM first.`,
      );
    }
  }
  let registered = false;
  if (childPid > 0 && vsockUdsPath) {
    try {
      writeEntry({
        pid: childPid,
        name: vmName,
        socketPath: vsockUdsPath,
        imagePath: opts.image ? resolve(opts.cwd ?? process.cwd(), opts.image) : undefined,
        diskPath: diskAbs,
        forkedFrom: opts.forkedFrom,
        startedAt: Date.now(),
      });
      registered = true;
      debug("registered pid=%d name=%s", childPid, vmName ?? "<unset>");
    } catch (err) {
      // Registry write is best-effort; attach won't find this VM but
      // local boot-and-use still works fine.
      debug(
        "registry write failed (best-effort) err=%s",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  child.once("exit", (code, signal) => {
    debug(
      "VMM exit pid=%d code=%s signal=%s lifetimeMs=%d",
      childPid,
      code,
      signal,
      Date.now() - bootT0,
    );
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
    for (const stop of liveMountStops) {
      void stop().catch(() => {});
    }
    if (registered) {
      removeEntry(childPid);
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
  const onLog = opts.onLog;
  if (onLog) {
    child.stderr.on("data", (chunk: Buffer) => {
      onLog({ source: "guest-console", chunk });
    });
  }

  // DEBUG=machinen:vmm tees the VMM's stderr (kernel + early-userspace
  // console) to the host stderr in real time. Replaces the legacy
  // MACHINEN_BUILD_DEBUG flag.
  if (vmmDebug.enabled) {
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
  }

  const handle: VmHandle = {
    pid: childPid,
    name: vmName,
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
                  () =>
                    reject(new BootError("BOOT_TIMEOUT", `VMM did not exit within ${timeoutMs}ms`)),
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
        throw new ExecError(
          "EXEC_VSOCK_UNAVAILABLE",
          "vm.exec: no vsock UDS available — MACHINEN_VSOCK was set to an " +
            "unrecognized spec. Expected `in:<port>:<uds-path>`.",
        );
      }
      const res = await VsockExec.run(vsockUdsPath, cmd, teeOnLog(cmd, execOpts, onLog));
      if (res.exitCode !== 0) {
        throw new ExecError(
          "EXEC_NONZERO_EXIT",
          `vm.exec failed (code ${res.exitCode}): ${cmd}\nstderr:\n${res.stderr}`,
        );
      }
      return res;
    },

    execRaw(cmd, execOpts) {
      if (!vsockUdsPath) {
        return Promise.reject(
          new ExecError(
            "EXEC_VSOCK_UNAVAILABLE",
            "vm.execRaw: no vsock UDS available — MACHINEN_VSOCK was set to " +
              "an unrecognized spec. Expected `in:<port>:<uds-path>`.",
          ),
        );
      }
      return VsockExec.run(vsockUdsPath, cmd, teeOnLog(cmd, execOpts, onLog));
    },

    async writeFile(guestPath, contents, writeOpts) {
      await this.exec(buildWriteFileCmd(guestPath, contents, writeOpts));
    },

    async snapshot(snapshotOpts) {
      if (!diskAbs) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.snapshot: no disk was attached at boot. Pass `snapshot: '<path>'` to " +
            "boot() so CRIU has a target to write to.",
        );
      }
      if (liveMountsResolved.length > 0) {
        // A live mount is a persistent vsock channel that CRIU has no
        // way to freeze. Snapshotting and later restoring would leave
        // the guest pointing at a dead UDS / dead host server, with
        // every FS op returning errors. Refuse loudly until we decide
        // how the two should compose (issue #78 "Known tradeoffs").
        throw new SnapshotError(
          "SNAPSHOT_LIVE_MOUNT_ACTIVE",
          "vm.snapshot: cannot snapshot a VM with --mount-live active. " +
            "The vsock FUSE channel doesn't survive snapshot/restore. " +
            "Re-boot without live mounts if you need to snapshot, or use " +
            "`--mount` (copy-once) which is baked into the rootfs and " +
            "snapshots cleanly.",
        );
      }
      return performSnapshot(
        {
          pid: childPid,
          sourceName: vmName,
          diskPath: diskAbs,
          execRaw: (cmd, execOpts) => this.execRaw(cmd, execOpts),
          wait: () => this.wait(),
          kill: () => this.kill(),
          teeGuestConsole: (onChunk) => {
            child.stderr.on("data", onChunk);
          },
          errorOutput: () => this.errorOutput(),
        },
        snapshotOpts,
      );
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
  /**
   * Look up a VM by the host pid of its VMM process. Kernel-unique
   * while alive; mutually exclusive with `name`. Exactly one of
   * `pid` / `name` is required.
   */
  pid?: number;
  /** Look up a VM by the name passed to `boot({ name })`. */
  name?: string;
  /**
   * Streaming log callback — fires for every byte of output from execs
   * made through the returned handle. See #83. Guest kernel console is
   * not available on attach handles (it belongs to the process that
   * called `boot()`), so only `exec-stdout` / `exec-stderr` sources fire.
   */
  onLog?: OnLog;
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
 *
 * @throws {RegistryError} REGISTRY_VM_NOT_FOUND
 */
export async function attach(opts: AttachOptions): Promise<VmHandle> {
  debugAttach("attach lookup pid=%s name=%s", opts.pid ?? "<unset>", opts.name ?? "<unset>");
  const entry = findEntry(opts);
  if (!entry) {
    const q = opts.pid !== undefined ? `pid ${opts.pid}` : `name ${opts.name}`;
    debugAttach("attach miss for %s", q);
    throw new RegistryError("REGISTRY_VM_NOT_FOUND", `attach: no running VM found for ${q}`);
  }
  debugAttach(
    "attach hit pid=%d name=%s sock=%s",
    entry.pid,
    entry.name ?? "<unset>",
    entry.socketPath,
  );
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
    pid: entry.pid,
    name: entry.name,
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
      const res = await VsockExec.run(entry.socketPath, cmd, teeOnLog(cmd, execOpts, opts.onLog));
      if (res.exitCode !== 0) {
        throw new ExecError(
          "EXEC_NONZERO_EXIT",
          `vm.exec failed (code ${res.exitCode}): ${cmd}\nstderr:\n${res.stderr}`,
        );
      }
      return res;
    },

    execRaw(cmd, execOpts) {
      return VsockExec.run(entry.socketPath, cmd, teeOnLog(cmd, execOpts, opts.onLog));
    },

    async writeFile(guestPath, contents, writeOpts) {
      await this.exec(buildWriteFileCmd(guestPath, contents, writeOpts));
    },

    async snapshot(snapshotOpts) {
      if (!entry.diskPath) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.snapshot: no disk was attached at boot. The VM must have been booted " +
            "with `snapshot: '<path>'` so CRIU has a target to write to.",
        );
      }
      return performSnapshot(
        {
          pid: entry.pid,
          sourceName: entry.name,
          diskPath: entry.diskPath,
          execRaw: (cmd, execOpts) => this.execRaw(cmd, execOpts),
          wait: () => this.wait(),
          kill: () => this.kill(),
          // Attach handles don't own the VMM child, so there's no guest
          // console stream to tee. Dump/CRIU failure detail still flows
          // via exec-stdout / exec-stderr tags.
          teeGuestConsole: undefined,
          errorOutput: async () => "",
        },
        snapshotOpts,
      );
    },
  };
  return handle;
}

/**
 * Peek at `/machinen-config.json` inside an image tarball (produced by
 * `provision({ cmd, env })`). Returns the baked cmd/env if present, or
 * undefined when the image has no config baked in — plain rootfs
 * tarballs that pre-date this feature still boot fine.
 */
function readImageConfig(
  imagePath: string,
): { cmd?: string[]; env?: Record<string, string> } | undefined {
  try {
    // `-x` stream-extract, `-O` to stdout, `-z` auto-detect gzip. The
    // target path matches the layout `provision()` writes.
    const out = execFileSync("tar", ["-xzOf", imagePath, "./machinen-config.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (!out.trim()) {
      return undefined;
    }
    return JSON.parse(out) as { cmd?: string[]; env?: Record<string, string> };
  } catch {
    // Either the tarball lacks the file or it's not a tarball we can
    // read — boot will still try to use the rootfs as-is.
    return undefined;
  }
}

/**
 * A caller-provided `liveMounts` entry after validation, with the
 * vsock port + host UDS path allocated. Threaded from `boot()` into
 * the initramfs packer so the config and the host servers agree on
 * ports and guest paths.
 */
interface ResolvedLiveMount {
  host: string;
  guest: string;
  port: number;
  udsPath: string;
}

/** Base vsock port for live mounts. Chosen below the exec/file/
 *  secrets/winsize agent band (1975–1978) so it doesn't collide. */
const LIVE_MOUNT_PORT_BASE = 1970;

function resolveLiveMounts(
  mounts: Array<{ host: string; guest: string }>,
  cwd: string | undefined,
  udsDir: string,
): ResolvedLiveMount[] {
  return mounts.map((m, i) => {
    validateMountGuest(m.guest);
    const hostAbs = resolve(cwd ?? process.cwd(), m.host);
    if (!existsSync(hostAbs)) {
      throw new BootError(
        "BOOT_MOUNT_HOST_NOT_FOUND",
        `liveMounts[${i}] host path not found: ${m.host}`,
      );
    }
    if (!statSync(hostAbs).isDirectory()) {
      throw new BootError(
        "BOOT_MOUNT_INVALID",
        `liveMounts[${i}] host path must be a directory: ${m.host}`,
      );
    }
    return {
      host: hostAbs,
      guest: normalizeMountGuest(m.guest),
      port: LIVE_MOUNT_PORT_BASE + i,
      udsPath: join(udsDir, `live-mount-${i}.sock`),
    };
  });
}

function synthesizeAndPackBundle(
  opts: BootOptions,
  mergedGuestEnv: Record<string, string>,
  liveMounts: ResolvedLiveMount[],
): { tempDir: string; cpioPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "machinen-bundle-"));
  const cpioPath = join(tempDir, "initramfs.cpio");
  const synthBundleDir = join(tempDir, "bundle");
  const cleanup = () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  };

  let baseAbs: string | undefined;
  let imageConfig: { cmd?: string[]; env?: Record<string, string> } | undefined;
  if (opts.image) {
    baseAbs = resolve(opts.cwd ?? process.cwd(), opts.image);
    if (!existsSync(baseAbs)) {
      cleanup();
      throw new BootError("BOOT_IMAGE_NOT_FOUND", `image tarball not found: ${baseAbs}`);
    }
    imageConfig = readImageConfig(baseAbs);
  }

  // cmd resolution:
  //   - Snapshot-only restore (`boot({ snapshot })` with no cmd):
  //     synthesize `["/sbin/machinen-restore"]`. The helper mounts
  //     /dev/vda, spawns a fresh exec-agent, and runs `criu-ns
  //     restore` against the baked images.
  //   - Normal boot: user's cmd wins; fall back to image's baked
  //     default. Then wrap in /sbin/machinen-supervisor so the
  //     workload runs as a CRIU-dumpable child of /init and the
  //     exec-agent stays alive alongside it for vm.exec / vm.snapshot.
  //     Exception: if the cmd is already `/exec-agent`, skip the
  //     wrapper — the workload IS the agent (provision() flow).
  //   - Neither snapshot nor cmd and no image default: error.
  let effectiveCmd: string[] | undefined;
  const hasSnapshot = Boolean(opts.snapshot);
  if (opts.cmd) {
    effectiveCmd = opts.cmd;
  } else if (imageConfig?.cmd) {
    effectiveCmd = imageConfig.cmd;
  } else if (hasSnapshot) {
    effectiveCmd = ["/sbin/machinen-restore"];
  }
  if (!effectiveCmd) {
    cleanup();
    throw new BootError(
      "BOOT_CMD_MISSING",
      "boot: no cmd to run — pass `cmd` on boot() or bake one into the " +
        "image via `provision({ cmd })`.",
    );
  }

  // Wrap the cmd in the supervisor unless the caller is booting the
  // vsock agent directly (provision flow) or the runtime-synthesized
  // restore helper (which already manages the agent itself).
  //
  // When a disk is attached (opts.snapshot set), pass `--session` so
  // the supervisor runs the workload under `setsid`. CRIU dump
  // requires the workload to be its own session leader; without
  // --session, `criu dump --shell-job` fails with "session leader of
  // N(N) is outside of its pid namespace". Interactive boots (no
  // disk) skip --session so Ctrl-C / job control still work against
  // the console.
  const cmdHead = effectiveCmd[0];
  const isAgentDirect = cmdHead === "/exec-agent";
  const isRestoreHelper = cmdHead === "/sbin/machinen-restore";
  const supervisorArgs = opts.snapshot ? ["--session"] : [];
  const wrappedCmd =
    isAgentDirect || isRestoreHelper
      ? effectiveCmd
      : ["/sbin/machinen-supervisor", ...supervisorArgs, ...effectiveCmd];

  // env: image defaults overlaid by user + runtime-injected (gvproxy
  // cache mirror, etc.). User + runtime wins on key collision.
  const effectiveEnv = { ...imageConfig?.env, ...mergedGuestEnv };

  // Synthesize the bundle directory from the effective cmd + env. No
  // user-authored machinen-config.json; we generate it here and the
  // caller never sees it.
  mkdirSync(join(synthBundleDir, "rootfs"), { recursive: true });
  const configJson: Record<string, unknown> = { cmd: wrappedCmd, env: effectiveEnv };
  if (liveMounts.length > 0) {
    // Only the guest/port pairs get written — host paths never cross
    // into the guest's view. /init reads this and forks fuse-agent
    // per entry.
    configJson.liveMounts = liveMounts.map(({ guest, port }) => ({ guest, port }));
  }
  writeFileSync(join(synthBundleDir, "machinen-config.json"), JSON.stringify(configJson));

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
      throw new BootError(
        "BOOT_MOUNT_HOST_NOT_FOUND",
        `mount host path not found: ${opts.mount.host}`,
      );
    }
    if (!statSync(hostAbs).isDirectory()) {
      cleanup();
      throw new BootError(
        "BOOT_MOUNT_INVALID",
        `mount host path must be a directory (got a file): ${opts.mount.host}`,
      );
    }
    mount = { host: hostAbs, guest: normalizeMountGuest(opts.mount.guest) };
  }

  try {
    mkinitramfsPackBundle({
      bundle: synthBundleDir,
      out: cpioPath,
      base: baseAbs,
      mount,
      env: effectiveEnv,
      fuseAgentPath: liveMounts.length > 0 ? defaultFuseAgentPath() : undefined,
    });
  } catch (err) {
    cleanup();
    const msg = err instanceof Error ? err.message : String(err);
    throw new BootError("BOOT_PACK_FAILED", `mkinitramfs pack failed: ${msg}`, { cause: err });
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
    throw new BootError("BOOT_MOUNT_INVALID", `mount guest path must be absolute: ${guest}`);
  }
  const trimmed = normalizeMountGuest(guest);
  if (!trimmed.startsWith(MOUNT_ROOT) || trimmed === MOUNT_ROOT.replace(/\/$/, "")) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      `mount guest path must live under ${MOUNT_ROOT} (got ${guest}) — ` +
        `pick a sub-path like ${MOUNT_ROOT}app`,
    );
  }
}

/**
 * Single-quote a string for safe interpolation inside a shell single-
 * quoted literal. Embedded single quotes get the standard
 * `'\''` close-escape-reopen treatment.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the shell pipeline that `vm.writeFile()` ships through the
 * exec-agent. Stays single-line so it works against the legacy EXEC
 * opcode too (no need for the EXEC2 multi-line frame, which only newer
 * agents understand).
 *
 * Encoding: contents go over the wire as base64 inside an `echo … |
 * base64 -d` pipe, so any byte sequence (binary, newlines, quotes) is
 * safe. `mkdir -p` runs first when `recursive` (the default).
 */
export function buildWriteFileCmd(
  guestPath: string,
  contents: Buffer | string,
  opts: WriteFileOptions = {},
): string {
  const buf = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  const b64 = buf.toString("base64");
  const path = shellQuote(guestPath);
  const redir = opts.append ? ">>" : ">";
  const parts: string[] = [];
  if (opts.recursive ?? true) {
    parts.push(`mkdir -p -- "$(dirname -- ${path})"`);
  }
  // base64 has no shell metacharacters, but we still single-quote it
  // so the printf carries it verbatim regardless of length.
  parts.push(`printf %s ${shellQuote(b64)} | base64 -d ${redir} ${path}`);
  if (opts.mode !== undefined) {
    if (!Number.isInteger(opts.mode) || opts.mode < 0 || opts.mode > 0o7777) {
      throw new RangeError(`writeFile: mode out of range (got ${opts.mode})`);
    }
    parts.push(`chmod ${opts.mode.toString(8).padStart(3, "0")} ${path}`);
  }
  return parts.join(" && ");
}

/**
 * Layer an `onLog` over per-call `onStdout` / `onStderr`: the caller's
 * narrow callbacks still fire if they set them, and the handle-level
 * `onLog` receives a tagged event for every chunk. See #83.
 */
function teeOnLog(
  cmd: string,
  execOpts: VsockExecOptions | undefined,
  onLog: OnLog | undefined,
): VsockExecOptions | undefined {
  if (!onLog) {
    return execOpts;
  }
  const userOnStdout = execOpts?.onStdout;
  const userOnStderr = execOpts?.onStderr;
  return {
    ...execOpts,
    onStdout(chunk) {
      onLog({ source: "exec-stdout", cmd, chunk });
      userOnStdout?.(chunk);
    },
    onStderr(chunk) {
      onLog({ source: "exec-stderr", cmd, chunk });
      userOnStderr?.(chunk);
    },
  };
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
 * Injection surface for `performSnapshot`. The boot-owned handle and
 * the attach handle both plug in the same way, swapping `teeGuestConsole`
 * (only boot has a live stderr stream) and `errorOutput` (attach can't
 * see the guest console).
 */
interface SnapshotContext {
  /** PID of the host VMM process — used in debug logs. */
  pid: number;
  /** Optional source name (from `boot({ name })`); written into bundle meta.json. */
  sourceName?: string;
  /** Host file backing /dev/vda — what we copy into the bundle on success. */
  diskPath: string;
  execRaw: (cmd: string, opts?: VsockExecOptions) => Promise<VsockExecResult>;
  wait: () => Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill: () => Promise<void>;
  teeGuestConsole: ((onChunk: (chunk: Buffer) => void) => void) | undefined;
  errorOutput: () => Promise<string>;
}

/**
 * Drive a CRIU dump inside the guest, wait for the VMM to exit, and
 * copy the disk to the caller's outPath. Shared between boot-owned
 * handles (`boot().snapshot(...)`) and attach handles
 * (`attach().snapshot(...)`).
 *
 * Success signal (cross-process-safe):
 *   - Kick off /sbin/machinen-dump via vsock exec.
 *   - Wait for the VMM child to exit.
 *   - If the host's kill-timer fired first, it's a SNAPSHOT_TIMEOUT.
 *   - Otherwise the guest shut down cleanly under its own steam,
 *     which only happens after /sbin/machinen-supervisor's wait()
 *     returned — i.e. CRIU killed the dumped tree (success) or the
 *     workload exited on its own (also fine; the dump either happened
 *     before that or not at all). A failed dump does NOT kill the
 *     workload, so the supervisor keeps waiting and the kill-timer
 *     fires.
 *
 * The previous string-grep on `"dump OK"` in the VMM stderr was
 * swapped out because attach-owned handles have no guest-console
 * stream — the kill-timer boundary is the same signal without
 * requiring console access.
 */
async function performSnapshot(
  ctx: SnapshotContext,
  opts: SnapshotOptions,
): Promise<SnapshotResult> {
  const dumpCmd = opts.dumpCmd ?? "/sbin/machinen-dump";
  const deadlineMs = opts.timeoutMs ?? 90_000;
  const onLog = opts.onLog;
  const t0 = Date.now();

  // Validate / prepare the bundle directory. We refuse to overwrite
  // an existing populated directory so a previous snapshot can't
  // disappear under a typo'd outDir.
  const snapDir = resolve(opts.outDir);
  if (existsSync(snapDir)) {
    if (!statSync(snapDir).isDirectory()) {
      throw new SnapshotError(
        "SNAPSHOT_DUMP_FAILED",
        `vm.snapshot: outDir exists and is not a directory: ${snapDir}`,
      );
    }
    // An existing-but-empty dir is fine (CI fixtures preallocate it);
    // anything with content gets refused.
    const entries = readdirSync(snapDir);
    if (entries.length > 0) {
      throw new SnapshotError(
        "SNAPSHOT_DUMP_FAILED",
        `vm.snapshot: outDir is not empty: ${snapDir}`,
      );
    }
  } else {
    mkdirSync(snapDir, { recursive: true });
  }

  // Snapshot-dump produces a write to /dev/vda (mkfs.ext4 + CRIU
  // images). mtime is our secondary success signal — if the VMM exits
  // without the disk file being written, the dump didn't run. Catches
  // cases where /usr/bin/true (or any no-op binary) exits cleanly
  // before the dump has any effect.
  const preMtime = statSync(ctx.diskPath).mtimeMs;
  debugSnapshot(
    "snapshot start pid=%d snapDir=%s dumpCmd=%s timeoutMs=%d diskPath=%s preMtime=%d",
    ctx.pid,
    snapDir,
    dumpCmd,
    deadlineMs,
    ctx.diskPath,
    preMtime,
  );

  if (onLog && ctx.teeGuestConsole) {
    ctx.teeGuestConsole((chunk) => {
      onLog({ source: "guest-console", chunk });
    });
  }

  // Kick off the in-guest dump. The vsock connection typically closes
  // mid-transaction as the guest powers off — `.catch(() => {})` swallows
  // that expected tear-down; the real success signal is the VMM exit
  // below. If the dump script fails outright before the guest powers
  // off, the kill-timer below catches the hang.
  void ctx
    .execRaw(dumpCmd, {
      connectTimeoutMs: 2_000,
      onStdout: onLog
        ? (chunk) => onLog({ source: "exec-stdout", cmd: dumpCmd, chunk })
        : undefined,
      onStderr: onLog
        ? (chunk) => onLog({ source: "exec-stderr", cmd: dumpCmd, chunk })
        : undefined,
    })
    .catch(() => {});

  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    void ctx.kill();
  }, deadlineMs);
  killTimer.unref();
  try {
    await ctx.wait();
  } finally {
    clearTimeout(killTimer);
  }
  const elapsedMs = Date.now() - t0;
  const consoleLog = await ctx.errorOutput();
  debugSnapshot(
    "guest exited elapsed=%dms consoleBytes=%d timedOut=%s",
    elapsedMs,
    consoleLog.length,
    timedOut,
  );

  if (timedOut) {
    throw new SnapshotError(
      "SNAPSHOT_TIMEOUT",
      `vm.snapshot: guest did not shut down within ${deadlineMs}ms — dump likely failed.` +
        (consoleLog ? `\nConsole tail:\n${consoleLog.slice(-2000)}` : ""),
    );
  }

  // The VMM exited in time, but we still need to confirm the dump
  // actually ran. `/usr/bin/true` boots, exits immediately, and the
  // VMM comes down cleanly without ever touching the disk — we don't
  // want that to pass as success. mtime delta catches it.
  const postMtime = statSync(ctx.diskPath).mtimeMs;
  if (postMtime === preMtime) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: guest exited without writing to the disk — the dump script " +
        "never ran (is /sbin/machinen-dump present in the rootfs?)." +
        (consoleLog ? `\nConsole tail:\n${consoleLog.slice(-2000)}` : ""),
    );
  }

  const diskOut = join(snapDir, "disk.img");
  debugSnapshot("copy disk %s -> %s", ctx.diskPath, diskOut);
  copyFileSync(ctx.diskPath, diskOut);

  // Drop the bundle metadata next to the image so `restore({ snapDir })`
  // can recover the source name without poking at the disk.
  const meta: SnapshotMeta = {
    sourceName: ctx.sourceName,
    snappedAt: Date.now(),
  };
  writeFileSync(join(snapDir, "meta.json"), JSON.stringify(meta));

  debugSnapshot("snapshot done snapDir=%s postMtime=%d", snapDir, postMtime);
  return { snapDir, diskPath: diskOut, elapsedMs, consoleLog };
}

export interface RestoreOptions extends Omit<BootOptions, "snapshot" | "image" | "cmd" | "name"> {
  /**
   * Snapshot bundle directory produced by `vm.snapshot()`.
   * Must contain `disk.img` and `meta.json`.
   */
  snapDir: string;
  /**
   * Override the rootfs image used for the restore boot. Defaults
   * to whatever caller passes through `image`-equivalent — but
   * `restore()` always needs a base rootfs in the initramfs to
   * carry /sbin/machinen-restore + criu. Most callers pass the
   * release rootfs path here.
   */
  image?: string;
  /**
   * Optional explicit name for the restored VM. When omitted, the
   * fork is auto-named `<sourceName>/<pid>` after spawn so it stays
   * unique under the source's namespace.
   */
  name?: string;
}

/**
 * Restore a microVM from a snapshot bundle produced by
 * `vm.snapshot({ outDir })`. Reads the bundle's `meta.json` to
 * recover the source name, then `boot()`s with the right knobs:
 *
 *   - `snapshot: <snapDir>/disk.img`  attaches the dump as /dev/vda
 *   - `name: <sourceName>/<pid>`      auto-named fork (unless caller
 *                                     passed `name`)
 *   - `forkedFrom: <snapDir>`         lineage for `machinen ls`
 *
 * The auto-name uses pid because pids are kernel-unique-while-live
 * and we get one for free after spawn — no extra counter state.
 *
 * @throws {BootError} BOOT_SNAPSHOT_NOT_FOUND if `<snapDir>/disk.img`
 *   is missing.
 */
export async function restore(opts: RestoreOptions): Promise<VmHandle> {
  const snapDir = resolve(opts.snapDir);
  const diskPath = join(snapDir, "disk.img");
  const metaPath = join(snapDir, "meta.json");
  if (!existsSync(diskPath)) {
    throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", `restore: ${diskPath} not found`);
  }
  let meta: SnapshotMeta = { snappedAt: 0 };
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8")) as SnapshotMeta;
    } catch {
      // Bundle predates metadata or got corrupted; fall through with
      // an anonymous source name. The fork still boots; it just won't
      // have a memorable auto-name.
    }
  }

  // boot() doesn't know the pid until after the VMM is spawned, so
  // we can't pass `<sourceName>/<pid>` up front. Boot anonymous,
  // then claim the auto-name and patch the registry entry below.
  const vm = await boot({
    ...opts,
    snapshot: diskPath,
    forkedFrom: snapDir,
    name: opts.name,
  });

  if (!opts.name && meta.sourceName) {
    const autoName = `${meta.sourceName}/${vm.pid}`;
    if (claimName(autoName, vm.pid)) {
      // Promote the registry entry to carry the auto-name.
      const cur = findEntry({ pid: vm.pid });
      if (cur) {
        writeEntry({ ...cur, name: autoName });
      }
      // Mutate the handle so `vm.name` reflects the resolved name.
      (vm as { name?: string }).name = autoName;
    }
  }
  return vm;
}

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
