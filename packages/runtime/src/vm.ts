// @machinen/runtime — TypeScript surface for booting microVMs.
//
// The Zig VMM is a separate binary (today: the test binary produced
// by `zig build test` in packages/microvm). This module wraps it so
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

import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn as nodeSpawn,
} from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, homedir, platform as osPlatform, tmpdir, totalmem } from "node:os";
import { join, resolve } from "node:path";
import type { Readable } from "node:stream";
import debugLib from "debug";
import {
  defaultFuseAgentPath,
  packBundle as mkinitramfsPackBundle,
  packTinyBundle as mkinitramfsPackTinyBundle,
} from "./mkinitramfs.ts";
import {
  describePortHolder,
  ensureGvproxy,
  exposePort,
  probeHostPortFree,
  spawnGvproxy,
  warnGvproxyMissing,
} from "./gvproxy.ts";
import { bootSnapshotPath, writeBootSnapshot } from "./detached-log.ts";
import { BootError, ExecError, RegistryError, SnapshotError } from "./errors.ts";
import { ensurePdeathsig, wrapWithPdeathsig } from "./pdeathsig.ts";
import { reflinkCopy } from "./reflink.ts";
import { ensureRootfsImage, markRootfsImageClean } from "./rootfs-img.ts";
import { VsockExec, type VsockExecOptions, type VsockExecResult } from "./exec.ts";
import { serveLiveMount } from "./mount-server.ts";
import { markPagemapsLazy } from "./lazy-pagemap.ts";
import type { OnLog } from "./log.ts";
import { PhaseTimer } from "./phase-timer.ts";
import { claimName, findEntry, isAlive, removeEntry, writeEntry } from "./registry.ts";
import type {
  ForkOptions,
  SnapshotMeta,
  SnapshotOptions,
  SnapshotResult,
  VmHandle,
  WriteFileOptions,
} from "./vm-handle.ts";

const debug = debugLib("machinen:boot");
const debugAttach = debugLib("machinen:attach");
const debugRestore = debugLib("machinen:restore");
const debugSnapshot = debugLib("machinen:snapshot");
const debugFork = debugLib("machinen:fork");
const vmmDebug = debugLib("machinen:vmm");

const require_ = createRequire(import.meta.url);

// Default size for the auto-allocated snapshot scratch (#TBD). Sparse,
// so the file's real disk usage stays at zero until the guest dumps
// memory pages into it via /sbin/machinen-dump. 8 GiB is enough headroom
// for a CRIU dump of typical dev workloads (Node, claude-code, a few
// shells) without bumping into the cap; callers with bigger workloads
// can pass an explicit `snapshot: '<path>'` and pre-allocate it themselves.
const SNAP_SCRATCH_BYTES = 8 * 1024 * 1024 * 1024;

function allocateSparseFile(path: string, sizeBytes: number): void {
  const fd = openSync(path, "w");
  try {
    const buf = Buffer.alloc(1);
    writeSync(fd, buf, 0, 1, sizeBytes - 1);
  } finally {
    closeSync(fd);
  }
}

// #263 phase A: pick the guest RAM ceiling (in MiB). Half of host RAM
// is generous enough for typical dev workloads while leaving the host
// responsive; the 16 GiB cap stops a 128 GiB workstation from handing
// out a ceiling that would dwarf the actual working set. The 512 MiB
// floor matches the `cfg.ram_size >= 16 MiB` assert in boot_*.zig with
// room to boot Debian + a small workload on memory-constrained hosts.
//
// The ceiling is approximately free until touched (see
// `packages/microvm/docs/memory.md`). Phase B's balloon will let the
// host reclaim pages the guest has freed; until then, raising the
// ceiling makes the high-water mark worse, so default conservatively.
const MEMORY_FLOOR_MIB = 512;
const MEMORY_CAP_MIB = 16384;

export function autoSizeMemoryMib(hostBytes: number = totalmem()): number {
  const hostMib = Math.floor(hostBytes / (1024 * 1024));
  const half = Math.floor(hostMib / 2);
  return Math.max(MEMORY_FLOOR_MIB, Math.min(half, MEMORY_CAP_MIB));
}

function validateMemoryMib(mib: number): number {
  if (!Number.isInteger(mib) || mib <= 0) {
    throw new BootError(
      "BOOT_MEMORY_INVALID",
      `boot: memory must be a positive integer (MiB, no unit suffix), got ${mib}`,
    );
  }
  if (mib < MEMORY_FLOOR_MIB) {
    throw new BootError(
      "BOOT_MEMORY_INVALID",
      `boot: memory must be at least ${MEMORY_FLOOR_MIB} MiB (got ${mib}); the kernel + ` +
        `initramfs need headroom to boot.`,
    );
  }
  return mib;
}

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
   * Working directory for the guest cmd. Lands as `cwd` in the
   * synthesized `/machinen-config.json`; `/init` calls `chdir()` to
   * this path before exec'ing the cmd. Useful with `mount` /
   * `liveMounts` to land directly inside the share (e.g.
   * `guestCwd: "/mnt/workspace"`).
   *
   * Must be absolute. Throws `BOOT_CWD_INVALID` for relative paths or
   * paths containing NULs. Same precedence as `cmd`/`env`: an
   * image-baked `cwd` is overridden by this field when both are set.
   */
  guestCwd?: string;
  /**
   * Attach a scratch virtio-blk device (`/dev/vdb`, or `/dev/vda` on
   * pre-#114 layouts) so this VM can be CRIU-snapshotted later via
   * `vm.snapshot()`. Three forms:
   *
   *   - `undefined` (default) — the runtime auto-allocates a per-boot
   *     ~8 GiB sparse scratch in `tmpdir()` and unlinks it on VM exit.
   *     Disk usage stays at zero until the guest writes; the upside is
   *     every booted VM is snapshotable without re-booting. See #50.
   *
   *   - `'<path>'` — caller-managed file. Used as-is (must exist).
   *     Used by `restore()` to attach a tar archive of the bundle's
   *     CRIU images on `/dev/vdb`; the guest's
   *     `/sbin/machinen-restore` untars it and runs `criu restore`.
   *     The runtime synthesizes `cmd: ['/sbin/machinen-restore']` if
   *     no other cmd is given.
   *
   *   - `false` — opt out entirely. No `/dev/vdb` attached. Use when
   *     you don't need snapshot capability and want to skip the
   *     (sparse, but still nonzero) inode allocation — typical for
   *     fast-cycling test boots.
   */
  snapshot?: string | false;
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
   * Absolute target size (bytes) for the materialized rootdisk image.
   * Defaults to `max(2 GiB, treeBytes * 2.5)` — generous enough that
   * boot-time `npm install -g <large package>` / `apt install ...`
   * land without ENOSPC. Bump this for workloads that write more
   * (e.g. 8 GiB for a build tree, 16 GiB for a model cache).
   *
   * The host file is sparse — unused capacity costs nothing on disk
   * until the guest writes. The guest's online ext4 grow (in /init)
   * resizes the on-disk filesystem to fill the file on every boot,
   * so bumping this against an existing cached image works without
   * a rematerialize.
   *
   * Ignored when `rootDisk` is a string path (the caller-provided
   * image is taken as-is) or `rootDisk: false`. See #131.
   */
  rootDiskSizeBytes?: number;
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
   * relay, and nothing is copied at boot. `mode` defaults to `"rw"` —
   * guest writes land on the host (#151, #156). Set `"ro"` for a
   * one-way share (host caches, untrusted guests).
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
  liveMounts?: Array<{ host: string; guest: string; mode?: "ro" | "rw" }>;
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
   * Guest RAM ceiling, in MiB (decimal integer; no unit suffixes). The
   * VMM reads this as `MACHINEN_MEMORY` (#263 phase A). Defaults to
   * `min(host_ram_mib / 2, 16384)` with a floor of 512 — sized for
   * typical dev workloads while leaving the host responsive. The
   * ceiling is approximately free until the guest touches a page (see
   * `packages/microvm/docs/memory.md`), so over-provisioning costs
   * little until phase B's balloon lands and lets it actually shrink.
   *
   * This is documented as a debug knob — most workloads should never
   * need to set it.
   */
  memory?: number;
  /**
   * Wrap the VMM through the parent-death shim so it dies with this
   * runtime process. Default true — the right answer for the common
   * "boot, do work, exit" CLI flow.
   *
   * Set to false when the VMM is supposed to outlive the spawning
   * process. `vm.fork()` (#216) sets this so the forked sibling
   * survives `cli fork` returning. Without it, the kqueue-watching
   * shim catches the CLI exit and SIGTERMs the fork mid-startup.
   */
  pdeathsig?: boolean;
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
  /**
   * Detach the VMM from the runtime parent so the parent can exit
   * while the VM keeps running (issue #150 phase 2). When set, `boot()`
   * blocks only until the guest produces its first console byte
   * (readiness signal) and then resolves a handle whose `.wait()` /
   * `.output()` no longer reflect the live VM — the parent has unrefed
   * the child and is free to exit.
   *
   * Forces `pdeathsig: false` (otherwise the parent's exit kills the
   * VMM, defeating the purpose). Refused in v1 alongside `liveMounts`,
   * `mount`, and `portForward`: those all keep helpers in the JS
   * process that the detached VMM still needs to call back into.
   * Phase 3 lifts those gates by extracting the helpers into
   * standalone daemons.
   *
   * Cleanup of per-boot reflink disks, bundle dirs, and vsock UDS
   * directories normally happens in the parent's `child.once("exit")`
   * hook. After detach the parent is gone, so those leak until the
   * follow-up `machinen gc` / `machinen stop` commands (PR2 of #150)
   * land. Use `--detached` only when you understand that trade-off.
   *
   * Reattach with `attach({ name | pid })` from another process —
   * the registry entry stays live, the vsock UDS is still listening.
   */
  detached?: boolean;
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
 *   BOOT_PORT_FORWARD_NO_GVPROXY | BOOT_PORT_FORWARD_IN_USE |
 *   BOOT_PACK_FAILED
 */
export async function boot(opts: BootOptions = {}): Promise<VmHandle> {
  const bootT0 = Date.now();
  // #221: per-phase wall-clock timeline emitted as one line under
  // DEBUG=machinen:boot once the VMM produces its first console byte.
  const phases = new PhaseTimer();
  debug(
    "boot entry image=%s cmd=%j name=%s portForward=%d hasSnapshot=%s mount=%s",
    opts.image ?? "<none>",
    opts.cmd ?? null,
    opts.name ?? "<unset>",
    (opts.portForward ?? []).length,
    Boolean(opts.snapshot),
    opts.mount ? `${opts.mount.host}->${opts.mount.guest}` : "<none>",
  );
  phases.start("asset-resolve");
  // #150 phase 2: refuse `--detached` with options that keep helpers
  // alive in the JS supervisor. After detach the supervisor is gone;
  // any guest call back into one of these (a FUSE op, an artifact-
  // cache fetch) would land on a dead socket. Phase 3 extracts those
  // helpers into standalone daemons — until then, the gate is hard.
  //
  // PR3 lifted the `portForward` restriction: gvproxy now also
  // detaches (its pid + socket dir are persisted in the registry so
  // `machinen stop` reaps them), and `exposePort` runs *before*
  // detach completes, so the forwards are configured by the time the
  // parent exits.
  if (opts.detached) {
    const incompatible: string[] = [];
    if (opts.mount) {
      incompatible.push("mount");
    }
    if ((opts.liveMounts ?? []).length > 0) {
      incompatible.push("liveMounts");
    }
    if (incompatible.length > 0) {
      throw new BootError(
        "BOOT_DETACHED_INCOMPATIBLE",
        `boot({ detached: true }) is not yet compatible with: ${incompatible.join(", ")}. ` +
          "Those keep helpers alive in the runtime supervisor — after detach, " +
          "the helpers die with it. Phase 3 of #150 will lift this restriction.",
      );
    }
  }
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
    // Pre-flight bind probe per requested host port. Without this,
    // gvproxy's control API surfaces `address already in use` as an
    // opaque GVPROXY_EXPOSE_FAILED 500 *after* we've spawned it. The
    // common cause is an orphaned gvproxy from a prior `kill -9` of
    // the runtime — the kernel reparents it to PID 1 and it keeps
    // holding the host port. Surface the orphan hypothesis directly
    // so the user knows what to clean up. See #115.
    for (const m of portForward) {
      const host = m.hostAddr ?? "127.0.0.1";
      const errno = await probeHostPortFree(host, m.hostPort);
      if (errno) {
        // Best-effort: name the offending PID and flag whether it's
        // machinen-owned. lsof failures are non-fatal — fall back to the
        // generic orphan-gvproxy hypothesis so the message still helps.
        const holder = await describePortHolder(m.hostPort).catch(() => null);
        const detail = holder
          ? `${holder}.`
          : "Common cause: an orphaned gvproxy from a prior `kill -9` of the VMM. " +
            "Try `pkill -f gvproxy` to clear it, or pick a different host port.";
        throw new BootError(
          "BOOT_PORT_FORWARD_IN_USE",
          `portForward: host port ${host}:${m.hostPort} is already in use (${errno}). ${detail}`,
        );
      }
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
  phases.end("asset-resolve");

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...opts.vmmEnv,
  };

  // #263 phase A: forward the guest RAM ceiling so the VMM doesn't
  // fall back to its boot_*.zig hardcoded default. An explicit caller
  // value via vmmEnv wins over our auto-size; that's the documented
  // debug-knob escape hatch.
  if (env.MACHINEN_MEMORY === undefined) {
    const memoryMib =
      opts.memory !== undefined ? validateMemoryMib(opts.memory) : autoSizeMemoryMib();
    env.MACHINEN_MEMORY = String(memoryMib);
  }

  phases.start("disk-prep");
  let diskAbs: string | undefined;
  // #121: per-boot reflink clone of the cached `<sha>.img`. Tracking
  // it lets the exit handler delete the copy so guest writes don't
  // leak into the next boot from the same tarball. Stays undefined
  // for a caller-supplied `rootDisk: '<path>'` (we don't manage that
  // file's lifecycle) or `rootDisk: false`.
  let perBootRootDisk: string | undefined;
  // The scratch virtio-blk device serves two unrelated workloads:
  //   - caller-supplied path (string): a CRIU snapshot bundle to
  //     restore from at boot — the runtime synthesizes
  //     /sbin/machinen-restore when no cmd is given. The bundle is
  //     reflink-cloned into a per-boot path so a future `vm.snapshot()`
  //     against the restored VM doesn't corrupt the source bundle
  //     when machinen-dump.sh re-formats the disk (#207).
  //   - default (undefined): per-boot sparse scratch so any VM is
  //     CRIU-dumpable later via vm.snapshot(). 8 GiB sparse means zero
  //     real disk until the guest writes; cleaned up alongside the
  //     rootdisk reflink on VM exit. Don't synthesize restore for this
  //     case (the file is empty).
  //   - `false`: opt out, no /dev/vdb. Test-fast paths use this.
  let perBootSnapDisk: string | undefined;
  if (opts.snapshot === false) {
    // explicit opt-out
  } else if (typeof opts.snapshot === "string") {
    const bundleDisk = resolve(opts.cwd ?? process.cwd(), opts.snapshot);
    if (!existsSync(bundleDisk)) {
      throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", `snapshot image not found: ${bundleDisk}`);
    }
    // An explicit `cmd` means the caller is running their own workload
    // (e.g. provision()'s tar-to-/dev/vdb dump), not restoring a CRIU
    // bundle — so attach the disk in place. The reflink-clone below is
    // only needed for the restore path, where machinen-dump.sh later
    // mkfs's the scratch disk and would otherwise corrupt the source
    // bundle on the host fs (#207).
    if (opts.cmd) {
      diskAbs = bundleDisk;
      env.MACHINEN_DISK = bundleDisk;
      debug("snap-restore in-place (explicit cmd) path=%s", bundleDisk);
    } else {
      // Reflink-clone the bundle disk into a per-boot path so the
      // restored VM can be snapshotted again (#207). Same pattern as
      // #121 for the rootdisk: COPYFILE_FICLONE → cheap shared blocks
      // until guest writes, falls back to a full copy on non-reflink
      // filesystems.
      const perBoot = join(
        tmpdir(),
        `machinen-snap-restore-${process.pid}-${randomBytes(6).toString("hex")}.img`,
      );
      reflinkCopy(bundleDisk, perBoot);
      diskAbs = perBoot;
      perBootSnapDisk = perBoot;
      env.MACHINEN_DISK = perBoot;
      debug("snap-restore reflink-clone src=%s dst=%s", bundleDisk, perBoot);
    }
  } else if (opts.image) {
    // Auto-allocate only when the caller is booting a real image-backed
    // guest. VMM-only smoke boots (no image — e.g. MACHINEN_BOOT_TEST=1)
    // would otherwise be handed a zero-byte file as /dev/vda, failing
    // root mount; they have nothing to snapshot anyway. `cmd && !image`
    // already errors above, so this check covers all snapshotable
    // workload paths.
    const scratchPath = join(
      tmpdir(),
      `machinen-snap-${process.pid}-${randomBytes(6).toString("hex")}.img`,
    );
    allocateSparseFile(scratchPath, SNAP_SCRATCH_BYTES);
    diskAbs = scratchPath;
    perBootSnapDisk = scratchPath;
    env.MACHINEN_DISK = scratchPath;
    debug("snap-scratch auto path=%s sizeBytes=%d", scratchPath, SNAP_SCRATCH_BYTES);
  }
  phases.end("disk-prep");

  // #114: rootdisk-by-default. Boot mounts the rootfs from a
  // virtio-blk device (/dev/vda) instead of inflating the whole tree
  // into a RAM-backed tmpfs at boot. The user passes `rootDisk: false`
  // to opt back into the legacy cpio-as-rootfs path (rare — mostly for
  // tests that need to assert the initramfs path explicitly).
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
      // `out:` — the guest fuse-agent connects to (cid=2, port=lm.port);
      // when the VMM sees the REQUEST it dials the host's UDS where
      // serveLiveMount is listening. Using `in:` here would have the
      // VMM also listen on the UDS (clobbering serveLiveMount), and
      // since fuse-agent doesn't initiate, nothing would ever bridge.
      env.MACHINEN_VSOCK = `${env.MACHINEN_VSOCK},out:${lm.port}:${lm.udsPath}`;
    }
  }

  // gvproxy + host→guest port forwards (#87) are set up before the
  // VMM boots so packBundle sees a populated MACHINEN_NET_SOCKET. If
  // anything downstream throws (packBundle validation, exposePort
  // failure, nodeSpawn failure), the outer catch shuts gvproxy back
  // down — otherwise a failed boot would leave orphans behind.
  let gvStop: (() => void) | undefined;
  let gvPid: number | undefined;
  let gvExe: string | undefined;
  let gvSocketDir: string | undefined;
  const liveMountStops: Array<() => Promise<void>> = [];
  let bundleTempDir: string | undefined;
  const mergedGuestEnv: Record<string, string> = { ...opts.env };

  // Surface the VM name in the guest so an interactive shell prompt
  // (\h in bash's default Debian PS1) tells the user which VM they're
  // attached to. machinen-supervisor.sh consumes this and calls
  // sethostname() before spawning the workload. We don't have the host
  // VMM pid yet — that's only known after spawn — so the name-less case
  // simply doesn't set a hostname; users who want a labelled prompt
  // pass --name.
  if (opts.name && !mergedGuestEnv.MACHINEN_VM_NAME) {
    mergedGuestEnv.MACHINEN_VM_NAME = opts.name;
  }

  try {
    phases.start("net-services");
    phases.start("net-services.gvproxy");
    if (!env.MACHINEN_NET_SOCKET) {
      // Auto-install gvproxy on first use if not already resolvable —
      // visible stderr line; cached under ~/.machinen so subsequent
      // boots are silent. See #83 follow-up.
      const gvBin = await ensureGvproxy(binary);
      if (gvBin) {
        debug("starting gvproxy bin=%s", gvBin);
        // Detach gvproxy alongside the VMM so the parent can exit
        // without stranding the guest's networking (#150 phase 2 PR3).
        const gv = await spawnGvproxy(gvBin, { detached: opts.detached });
        env.MACHINEN_NET_SOCKET = gv.socketPath;
        gvStop = gv.stop;
        gvPid = gv.child.pid;
        gvExe = gvBin;
        gvSocketDir = gv.socketDir;
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
    phases.end("net-services.gvproxy");

    // #78: start one live-share server per resolved mount before the
    // VMM boots. The guest fuse-agent will dial these UDSes once it's
    // past /dev/fuse mount; if we started them after the VMM, the
    // agent would spin in connect-retry for as long as we took.
    phases.start("net-services.live-mounts");
    for (const lm of liveMountsResolved) {
      const handle = await serveLiveMount(lm.udsPath, {
        rootAbs: lm.host,
        mode: lm.mode,
      });
      liveMountStops.push(handle.stop);
    }
    phases.end("net-services.live-mounts");
    phases.end("net-services");

    // Pack an initramfs whenever the guest needs userspace (image +
    // cmd + snapshot-only restore all need /init + synthesized
    // machinen-config.json). Test-mode zig boots fall through with no
    // INITRD env set — the VMM uses its own fixture initramfs.
    if (opts.image || opts.cmd || opts.snapshot) {
      phases.start("initramfs-pack");
      const packed = synthesizeAndPackBundle(opts, mergedGuestEnv, liveMountsResolved, {
        useTiny: wantsRootDisk,
        env,
        onPhase: (name, ms) => phases.mark(`initramfs-pack.${name}`, ms),
      });
      bundleTempDir = packed.tempDir;
      env.MACHINEN_INITRD = packed.cpioPath;
      const packMs = phases.end("initramfs-pack");
      debug("initramfs packed cpio=%s elapsed=%dms", packed.cpioPath, packMs ?? -1);
    }

    // #114: rootDisk materialization. After all input validation has
    // passed (so a bad mount path or missing image fails before we
    // hash a multi-GB tarball). On a cache hit this is a few ms.
    phases.start("rootdisk-materialize");
    if (wantsRootDisk) {
      let rootDiskAbs: string;
      if (typeof opts.rootDisk === "string") {
        rootDiskAbs = resolve(opts.cwd ?? process.cwd(), opts.rootDisk);
        if (!existsSync(rootDiskAbs)) {
          throw new BootError("BOOT_IMAGE_NOT_FOUND", `rootDisk image not found: ${rootDiskAbs}`);
        }
      } else {
        // #121: hand the VMM a per-boot reflink clone of the cached
        // template, never the template itself. virtio-blk mounts the
        // image read-write, so without the clone every boot from the
        // same tarball would inherit the previous boot's writes
        // (apt installs leaking, /var/log poisoning, two concurrent
        // boots stomping each other's filesystem). COPYFILE_FICLONE →
        // APFS clonefile / Linux FICLONE on reflink-capable fs (free,
        // shared blocks until the guest writes); falls back to a
        // regular copy elsewhere (one-time cost, sparse).
        const baseAbs = resolve(opts.cwd ?? process.cwd(), opts.image!);
        const cachedImg = ensureRootfsImage(baseAbs, {
          sizeBytes: opts.rootDiskSizeBytes,
          // #233 follow-up: surface the sub-steps of ensureRootfsImage
          // (sha256, e2fsck, sparse-extend, …) as dot-separated
          // children of `rootdisk-materialize` in the boot timeline.
          onPhase: (name, ms) => phases.mark(`rootdisk-materialize.${name}`, ms),
        });
        const perBoot = join(
          tmpdir(),
          `machinen-rootdisk-${process.pid}-${randomBytes(6).toString("hex")}.img`,
        );
        const reflinkT0 = Date.now();
        reflinkCopy(cachedImg, perBoot);
        phases.mark("rootdisk-materialize.reflink", Date.now() - reflinkT0);
        // The cache file was only READ here — restore the
        // clean-shutdown marker so the next boot finds a usable
        // template instead of wiping and rematerializing (#170).
        markRootfsImageClean(cachedImg);
        perBootRootDisk = perBoot;
        rootDiskAbs = perBoot;
      }
      env.MACHINEN_ROOTDISK = rootDiskAbs;
    }
    phases.end("rootdisk-materialize");
  } catch (err) {
    for (const stop of liveMountStops) {
      await stop().catch(() => {});
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
    if (perBootRootDisk) {
      try {
        unlinkSync(perBootRootDisk);
      } catch {}
    }
    if (perBootSnapDisk) {
      try {
        unlinkSync(perBootSnapDisk);
      } catch {}
    }
    throw err;
  }

  // Wrap through the parent-death shim so the VMM dies with the
  // runtime instead of orphaning to PID 1 holding the rootdisk fd and
  // ~1.7 GiB RSS (#200). Mirrors `spawnGvproxy`. Falls through to a
  // direct spawn if the shim is unavailable (no `cc`, opted-out,
  // unsupported platform).
  //
  // Detached mode (#150) explicitly wants the orphan: the parent CLI
  // exits while the VMM keeps running. Force pdeathsig off, ignoring
  // any caller value, since both `pdeathsig: true` and the default
  // `undefined` would otherwise SIGTERM the VMM the moment the parent
  // exits.
  phases.start("vmm-spawn");
  const vmmPdeathsig = opts.detached || opts.pdeathsig === false ? null : await ensurePdeathsig();
  const wrappedVmm = wrapWithPdeathsig(vmmPdeathsig, binary, opts.args ?? []);
  const child = nodeSpawn(wrappedVmm.command, wrappedVmm.args, {
    cwd: opts.cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  phases.end("vmm-spawn");
  // first-guest-byte starts ticking from VMM-spawn — that's the point
  // after which any console output is real guest progress.
  phases.start("first-guest-byte");
  debug(
    "VMM spawned pid=%d binary=%s wrapped=%s elapsedSinceEntry=%dms",
    child.pid ?? -1,
    binary,
    vmmPdeathsig ? "yes" : "no",
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
  //
  // INVARIANT (#150 phase 2): this whole block must complete
  // synchronously before any `await` — in particular, before the
  // readiness gate further down can call `handle.detach()` and
  // unref the child. Detaching a name-conflict losers' child means
  // the SIGKILL above wouldn't reach an orphaned-to-PID-1 VMM.
  // Today the structure enforces this (no awaits between here and
  // the gate); don't reorder.
  const vmName = opts.name;
  // Resolved once: shared by the registry entry and any future snapshot
  // ctx so the bundle's meta.json points at the same absolute path the
  // source booted from. Cheap (just a path resolve), so unconditional.
  const sourceImageAbs = opts.image ? resolve(opts.cwd ?? process.cwd(), opts.image) : undefined;
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
  // #150 phase 2: detached VMs record where the boot-console snapshot
  // will land so `attach` / `ls` / `gc` can find it later.
  const bootLogPath = opts.detached && childPid > 0 ? bootSnapshotPath(childPid) : undefined;
  // #150 phase 2 PR2: persist per-boot artifacts in the registry so
  // `machinen gc` / `machinen stop` can clean them up after the
  // parent has exited (the in-process exit hook below stops firing
  // once we detach). Recorded for *every* boot, not just detached —
  // gc is a backstop, the inline rm still runs first for the common
  // attached case.
  const cleanupPaths: string[] = [];
  if (perBootRootDisk) {
    cleanupPaths.push(perBootRootDisk);
  }
  if (perBootSnapDisk) {
    cleanupPaths.push(perBootSnapDisk);
  }
  if (bundleTempDir) {
    cleanupPaths.push(bundleTempDir);
  }
  if (vsockTempDir) {
    cleanupPaths.push(vsockTempDir);
  }
  if (gvSocketDir) {
    cleanupPaths.push(gvSocketDir);
  }
  let registered = false;
  if (childPid > 0 && vsockUdsPath) {
    try {
      writeEntry({
        pid: childPid,
        name: vmName,
        socketPath: vsockUdsPath,
        imagePath: sourceImageAbs,
        diskPath: diskAbs,
        forkedFrom: opts.forkedFrom,
        bootLogPath,
        cleanupPaths: cleanupPaths.length > 0 ? cleanupPaths : undefined,
        vmmExe: binary,
        gvproxyPid: gvPid,
        gvproxyExe: gvExe,
        portForward: portForward.length > 0 ? portForward : undefined,
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
    // #121: drop the per-boot reflink copy so guest writes don't
    // persist across boots. Runs unconditionally (clean exit, signal
    // exit, kernel panic) — the cached `<sha>.img` template was
    // marked clean inline at copy time, so nothing here depends on
    // the exit being graceful.
    if (perBootRootDisk) {
      try {
        unlinkSync(perBootRootDisk);
      } catch {}
    }
    if (perBootSnapDisk) {
      try {
        unlinkSync(perBootSnapDisk);
      } catch {}
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
    if (gvStop) {
      gvStop();
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
  //
  // `collect()` ring-buffers to `CONSOLE_TAIL_BYTES` so a multi-hour
  // VM doesn't drag the supervisor toward OOM (issue #150).
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

  // #221: stamp first-guest-byte and emit the boot timeline. Either
  // path (first stderr byte, or VMM exit before any output) flushes
  // exactly once — `phases.end` is a no-op the second time around.
  // #233: also emit a `phase` LogEvent so callers can fold the
  // breakdown into their own UI without parsing debug strings.
  let phasesFlushed = false;
  const flushPhases = () => {
    if (phasesFlushed) {
      return;
    }
    phasesFlushed = true;
    phases.end("first-guest-byte");
    phases.flush(debug, "boot");
    onLog?.(phases.toEvent("boot"));
  };
  child.stderr.once("data", flushPhases);
  child.once("exit", flushPhases);

  // #150 phase 2: in-flight ring buffer of stderr captured *only* for
  // detached boots, dumped to `bootLogPath` once readiness fires. The
  // existing `errorCollector` resolves on stream close — too late for
  // the detach handoff. Capped at the same `CONSOLE_TAIL_BYTES` Phase 1
  // uses, so a slow boot can't balloon the supervisor heap before
  // detach completes.
  const detachedBootChunks: Buffer[] = [];
  let detachedBootBytes = 0;
  if (opts.detached) {
    child.stderr.on("data", (chunk: Buffer) => {
      detachedBootChunks.push(chunk);
      detachedBootBytes += chunk.length;
      while (
        detachedBootChunks.length > 1 &&
        detachedBootBytes - detachedBootChunks[0]!.length >= CONSOLE_TAIL_BYTES
      ) {
        detachedBootBytes -= detachedBootChunks.shift()!.length;
      }
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
      // Send SIGTERM, not SIGKILL: on darwin the spawn target is the
      // pdeathsig shim, which can't catch SIGKILL — that orphans its
      // inner VMM (#200), keeping the stderr pipe open so any caller
      // awaiting `errorOutput()` (collected via stream "close") never
      // wakes up. The shim does catch SIGTERM and forwards it to the
      // VMM, which exits cleanly. Linux has the same shape via
      // PR_SET_PDEATHSIG, so the same path applies.
      child.kill("SIGTERM");
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      // Escalate to SIGKILL if the shim+inner don't exit within 2s —
      // covers a wedged inner that ignores SIGTERM. SIGKILL'ing the
      // shim still orphans the inner, but at that point the inner is
      // already unresponsive and we've done what we can from here.
      const escalate = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {}
      }, 2_000);
      escalate.unref();
      try {
        await once(child, "exit");
      } finally {
        clearTimeout(escalate);
      }
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

    execPty(cmd, ptyOpts) {
      if (!vsockUdsPath) {
        // Synchronous-handle API can't reject like execRaw — surface
        // a handle whose `result` is already a rejected promise.
        const err = new ExecError(
          "EXEC_VSOCK_UNAVAILABLE",
          "vm.execPty: no vsock UDS available — MACHINEN_VSOCK was set to " +
            "an unrecognized spec. Expected `in:<port>:<uds-path>`.",
        );
        return {
          result: Promise.reject(err),
          resize: () => {},
          cancel: () => {},
        };
      }
      return VsockExec.startPty(vsockUdsPath, cmd, ptyOpts);
    },

    async writeFile(guestPath, contents, writeOpts) {
      for (const cmd of buildWriteFileCmds(guestPath, contents, writeOpts)) {
        await this.exec(cmd);
      }
    },

    async snapshot(snapshotOpts) {
      if (!diskAbs) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.snapshot: this VM was booted with `snapshot: false` (no scratch " +
            "disk attached). Re-boot without that flag — the runtime will " +
            "auto-allocate a sparse scratch — or pass `snapshot: '<path>'`.",
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
          sourceImage: sourceImageAbs,
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

    async fork(forkOpts) {
      if (!diskAbs) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.fork: source VM has no scratch disk (booted with `snapshot: false`). " +
            "Re-boot the source without that flag so it can be snapshotted.",
        );
      }
      if (liveMountsResolved.length > 0) {
        throw new SnapshotError(
          "SNAPSHOT_LIVE_MOUNT_ACTIVE",
          "vm.fork: cannot fork a VM with --mount-live active (same reason " +
            "vm.snapshot refuses — vsock FUSE channels don't survive CRIU).",
        );
      }
      return performFork(
        {
          pid: childPid,
          sourceName: vmName,
          sourceImage: sourceImageAbs,
          diskPath: diskAbs,
          execRaw: (cmd, execOpts) => this.execRaw(cmd, execOpts),
          wait: () => this.wait(),
          kill: () => this.kill(),
          teeGuestConsole: (onChunk) => {
            child.stderr.on("data", onChunk);
          },
          errorOutput: () => this.errorOutput(),
        },
        forkOpts ?? {},
      );
    },
  };

  // Set a per-VM kernel hostname so `\h` prompts and other
  // hostname-aware tooling can tell VMs apart. Fire-and-forget
  // over vsock — for fresh boots this races bash startup, so a
  // workload shell may still cache the kernel's pre-call value
  // (`(none)` on Linux). Subsequent shells (e.g. via
  // `machinen attach`) read the post-call value. Suppressed when
  // we have no vsock UDS (boot-without-exec-agent paths).
  if (vsockUdsPath) {
    void setGuestHostname(handle, buildGuestHostname(handle.pid, handle.name));
  }

  // #150 phase 2: detached mode blocks until the guest produces its
  // first console byte (readiness), then dumps the boot snapshot,
  // unrefs the child, and resolves. Two failure shapes to gate on:
  //
  //   - VMM dies in the readiness window. The exit hook above will
  //     have torn down per-boot disks / vsock dirs / gvproxy / cache /
  //     live mounts already; we still need to surface the failure to
  //     the caller instead of silently resolving. Snapshot whatever
  //     stderr we captured before death so a post-mortem has bytes
  //     to work with.
  //   - Readiness never arrives. Cap at `timeoutMs` (caller default
  //     60s, CLI passes null for interactive boots — but `--detached`
  //     forces a finite wait so the CLI can exit cleanly).
  if (opts.detached && bootLogPath) {
    const readinessTimeoutMs = timeoutMs ?? 60_000;
    let onByte: (() => void) | null = null;
    let onExit: (() => void) | null = null;
    const readiness = new Promise<"ready" | "exit">((resolve) => {
      onByte = () => resolve("ready");
      onExit = () => resolve("exit");
      child.stderr.once("data", onByte);
      child.once("exit", onExit);
    });
    const timeoutP = new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), readinessTimeoutMs).unref();
    });
    const outcome = await Promise.race([readiness, timeoutP]);
    // Cleanup whichever listeners didn't fire so a throw below doesn't
    // leave orphaned handlers holding the event loop.
    if (onByte) {
      child.stderr.removeListener("data", onByte);
    }
    if (onExit) {
      child.removeListener("exit", onExit);
    }
    // Always dump whatever stderr we have so far — failure paths
    // benefit from the snapshot more than success paths do.
    writeBootSnapshot(bootLogPath, Buffer.concat(detachedBootChunks).toString("utf8"));
    if (outcome === "exit") {
      const code = child.exitCode;
      const signal = child.signalCode;
      throw new BootError(
        "BOOT_DETACHED_READINESS_FAILED",
        `boot --detached: VMM exited before readiness (code=${code} signal=${signal}). ` +
          `Boot console snapshot at ${bootLogPath}`,
      );
    }
    if (outcome === "timeout") {
      // The VMM is still alive but never wrote a console byte. Kill
      // it (parent still holds the pdeathsig-less child handle) so
      // we don't leave an orphan after throwing.
      try {
        child.kill("SIGTERM");
      } catch {}
      throw new BootError(
        "BOOT_DETACHED_READINESS_FAILED",
        `boot --detached: VMM did not signal readiness within ${readinessTimeoutMs}ms. ` +
          `Boot console snapshot at ${bootLogPath}`,
      );
    }
    // Ready. Stop accumulating stderr — the snapshot is already on
    // disk, and post-detach bytes are the SIGPIPE-ignored bit-bucket.
    detachedBootChunks.length = 0;
    detachedBootBytes = 0;
    await handle.detach();
  }

  return handle;
}

/**
 * Parse the UDS path out of a `MACHINEN_VSOCK` spec. The spec may be a
 * single `<direction>:<port>:<uds-path>` entry or a comma-joined list
 * of them (`in:1978:/a,in:1974:/b,out:1970:/c`). For attach/exec we want
 * the FIRST `in:` entry's path — that's the exec-agent UDS the runtime
 * just allocated (or, when the caller set MACHINEN_VSOCK explicitly,
 * the entry they put first). Returns undefined on unrecognized shapes
 * so the handle can throw a clear error if `.exec()` ends up called on it.
 */
function parseVsockUdsPath(spec: string): string | undefined {
  for (const entry of spec.split(",")) {
    const match = entry.match(/^[^:]+:\d+:(.+)$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
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

    execPty(cmd, ptyOpts) {
      return VsockExec.startPty(entry.socketPath, cmd, ptyOpts);
    },

    async writeFile(guestPath, contents, writeOpts) {
      for (const cmd of buildWriteFileCmds(guestPath, contents, writeOpts)) {
        await this.exec(cmd);
      }
    },

    async snapshot(snapshotOpts) {
      if (!entry.diskPath) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.snapshot: this VM was booted with `snapshot: false` (no scratch " +
            "disk attached). Re-boot without that flag — the runtime will " +
            "auto-allocate a sparse scratch — or pass `snapshot: '<path>'`.",
        );
      }
      return performSnapshot(
        {
          pid: entry.pid,
          sourceName: entry.name,
          sourceImage: entry.imagePath,
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

    async fork(forkOpts) {
      if (!entry.diskPath) {
        throw new SnapshotError(
          "SNAPSHOT_NO_DISK",
          "vm.fork: source VM has no scratch disk (booted with `snapshot: false`).",
        );
      }
      return performFork(
        {
          pid: entry.pid,
          sourceName: entry.name,
          sourceImage: entry.imagePath,
          diskPath: entry.diskPath,
          execRaw: (cmd, execOpts) => this.execRaw(cmd, execOpts),
          wait: () => this.wait(),
          kill: () => this.kill(),
          teeGuestConsole: undefined,
          errorOutput: async () => "",
        },
        forkOpts ?? {},
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
/**
 * Shape of the optional `./machinen-config.json` baked into a rootfs
 * tarball by `provision({ cmd, env })`. `boot()` reads it via
 * `readImageConfig()` so callers don't need to re-pass `cmd`/`env` on
 * every boot. `warmImageConfigCache()` accepts the same shape so a
 * tarball-producing tool can pre-populate the lookup cache.
 */
export type ImageConfig = { cmd?: string[]; env?: Record<string, string>; cwd?: string };

/**
 * Disk cache for `readImageConfig`. The base tarball is regenerated only
 * by `scripts/build-base-assets.sh` / `provision()`, so its (size, mtime)
 * is a reliable fingerprint between runs. Without this cache, every
 * boot() pays ~170 ms decompressing a 2 GiB gzip stream looking for
 * (or failing to find) `./machinen-config.json` — that single call
 * was ~98 % of the `initramfs-pack` phase. Negative results are cached
 * too: most user-built tarballs don't carry the file.
 */
function imageConfigCacheDir(): string {
  return join(homedir(), ".cache", "machinen", "image-config");
}

function imageConfigCachePath(imagePath: string): string | undefined {
  let st;
  try {
    st = statSync(imagePath);
  } catch {
    return undefined;
  }
  // basename + size + mtime is enough to distinguish typical builds;
  // collisions are harmless because the cache file's body is the
  // authoritative answer for the keying tarball — a stale cache means
  // the tarball was overwritten without changing size+mtime, which
  // would also confuse `ensureRootfsImage`'s sha-based cache the same
  // way.
  const base = imagePath.split("/").pop() ?? "image";
  const key = `${base}-${st.size}-${Math.floor(st.mtimeMs)}.json`;
  return join(imageConfigCacheDir(), key);
}

/**
 * Pre-populate the image-config cache for a freshly-written tarball.
 * Lets `provision()` (and other tarball producers) skip the slow
 * `tar -xzOf` lookup that the next `boot()` would otherwise pay —
 * see #233. Best-effort: a missing/unwritable cache dir just falls
 * back to the slow path on the next boot.
 *
 * Call AFTER the tarball is on disk (so size+mtime match what the
 * cache key will be on read), passing exactly the config that was
 * baked into the tarball's `./machinen-config.json` (or `null` when
 * none was baked).
 */
export function warmImageConfigCache(imagePath: string, config: ImageConfig | null): void {
  const cachePath = imageConfigCachePath(imagePath);
  if (!cachePath) {
    return;
  }
  try {
    mkdirSync(imageConfigCacheDir(), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ config }));
  } catch {
    // Best-effort — a missing cache file just costs the next boot
    // an image-config-read hit.
  }
}

/** @internal — exported for tests; production callers should not use directly. */
export function readImageConfig(imagePath: string): ImageConfig | undefined {
  const cachePath = imageConfigCachePath(imagePath);
  if (cachePath && existsSync(cachePath)) {
    try {
      const raw = readFileSync(cachePath, "utf8");
      const cached = JSON.parse(raw) as { config: ImageConfig | null };
      return cached.config ?? undefined;
    } catch {
      // Corrupt cache — fall through, regenerate.
    }
  }
  let result: ImageConfig | undefined;
  try {
    // `-x` stream-extract, `-O` to stdout, `-z` auto-detect gzip. The
    // target path matches the layout `provision()` writes.
    const out = execFileSync("tar", ["-xzOf", imagePath, "./machinen-config.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (out.trim()) {
      result = JSON.parse(out) as ImageConfig;
    }
  } catch {
    // Either the tarball lacks the file or it's not a tarball we can
    // read — boot will still try to use the rootfs as-is.
  }
  if (cachePath) {
    try {
      mkdirSync(imageConfigCacheDir(), { recursive: true });
      writeFileSync(cachePath, JSON.stringify({ config: result ?? null }));
    } catch {
      // Best-effort cache write — a missing cache just means we redo
      // the slow path next time.
    }
  }
  return result;
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
  mode: "ro" | "rw";
}

/** Base vsock port for live mounts. Chosen below the exec/file/
 *  secrets/winsize agent band (1975–1978) so it doesn't collide. */
const LIVE_MOUNT_PORT_BASE = 1970;

function resolveLiveMounts(
  mounts: Array<{ host: string; guest: string; mode?: "ro" | "rw" }>,
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
      mode: m.mode ?? "rw",
    };
  });
}

/**
 * Build the synthesized `machinen-config.json` payload that /init
 * reads at boot. Pure: takes the already-merged effective cmd/env
 * plus the cwd inputs (user's guestCwd overrides image-baked cwd) and
 * the live-mount ports.
 *
 * Exposed for tests; `synthesizeAndPackBundle` is the only production
 * caller.
 *
 * @internal
 */
export function buildMachinenConfig(input: {
  cmd: string[];
  env: Record<string, string>;
  guestCwd?: string;
  imageCwd?: string;
  liveMounts: ResolvedLiveMount[];
}): Record<string, unknown> {
  // cwd: image-baked default overlaid by user's guestCwd (same
  // precedence as cmd/env). /init reads `cwd` and chdirs before exec.
  const effectiveCwd = input.guestCwd ?? input.imageCwd;

  const cfg: Record<string, unknown> = { cmd: input.cmd, env: input.env };
  if (effectiveCwd !== undefined) {
    cfg.cwd = effectiveCwd;
  }
  if (input.liveMounts.length > 0) {
    // Only the guest/port pairs get written — host paths never cross
    // into the guest's view. /init reads this and forks fuse-agent
    // per entry.
    cfg.liveMounts = input.liveMounts.map(({ guest, port }) => ({ guest, port }));
  }
  return cfg;
}

function synthesizeAndPackBundle(
  opts: BootOptions,
  mergedGuestEnv: Record<string, string>,
  liveMounts: ResolvedLiveMount[],
  packerOpts: {
    useTiny: boolean;
    env: Record<string, string>;
    onPhase?: (name: string, ms: number) => void;
  },
): { tempDir: string; cpioPath: string } {
  const tempDir = mkdtempSync(join(tmpdir(), "machinen-bundle-"));
  const cpioPath = join(tempDir, "initramfs.cpio");
  const synthBundleDir = join(tempDir, "bundle");
  const cleanup = () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  };

  if (opts.guestCwd !== undefined) {
    try {
      validateGuestCwd(opts.guestCwd);
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  let baseAbs: string | undefined;
  let imageConfig: { cmd?: string[]; env?: Record<string, string>; cwd?: string } | undefined;
  if (opts.image) {
    baseAbs = resolve(opts.cwd ?? process.cwd(), opts.image);
    if (!existsSync(baseAbs)) {
      cleanup();
      throw new BootError("BOOT_IMAGE_NOT_FOUND", `image tarball not found: ${baseAbs}`);
    }
    const cfgT0 = Date.now();
    imageConfig = readImageConfig(baseAbs);
    packerOpts.onPhase?.("image-config-read", Date.now() - cfgT0);
  }

  // cmd resolution:
  //   - Snapshot-only restore (`boot({ snapshot })` with no cmd):
  //     synthesize `["/sbin/machinen-restore"]`. The helper mounts
  //     /dev/vda, spawns a fresh exec-agent, and runs `criu restore`
  //     inside `unshare --pid --fork --mount-proc` so the dumped
  //     workload's PIDs don't collide with the restore-side helpers
  //     on chained restores (#215). This MUST take precedence over
  //     the rootfs's baked `imageConfig.cmd` — that field is the
  //     fresh-boot default; replaying it on restore would launch a
  //     brand-new workload instead of resuming the dumped one,
  //     silently dropping all in-memory state.
  //   - Normal boot: user's cmd wins; fall back to image's baked
  //     default. Then wrap in /sbin/machinen-supervisor so the
  //     workload runs as a CRIU-dumpable child of /init and the
  //     exec-agent stays alive alongside it for vm.exec / vm.snapshot.
  //     Exception: if the cmd is already `/exec-agent`, skip the
  //     wrapper — the workload IS the agent (provision() flow).
  //   - Neither snapshot nor cmd and no image default: error.
  let effectiveCmd: string[] | undefined;
  if (opts.cmd) {
    effectiveCmd = opts.cmd;
  } else if (typeof opts.snapshot === "string") {
    // Only synthesize the restore helper when the caller explicitly
    // passed a snapshot path. The auto-allocated scratch (default
    // `snapshot: undefined`) is empty, so synthesizing here would feed
    // CRIU a bundle-less file and fail.
    effectiveCmd = ["/sbin/machinen-restore"];
  } else if (imageConfig?.cmd) {
    effectiveCmd = imageConfig.cmd;
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
  // `--session` is the legacy "run under setsid" toggle from when CRIU
  // dumps required it but interactive boots didn't. Both modes now go
  // through the same `setsid -c -w` path in the supervisor, so the flag
  // is just consumed for back-compat. Pass it whenever a caller-managed
  // snapshot path is present — purely cosmetic, mirrors how older
  // releases logged the boot.
  const cmdHead = effectiveCmd[0];
  const isAgentDirect = cmdHead === "/exec-agent";
  const isRestoreHelper = cmdHead === "/sbin/machinen-restore";
  const supervisorArgs = typeof opts.snapshot === "string" ? ["--session"] : [];
  const wrappedCmd =
    isAgentDirect || isRestoreHelper
      ? effectiveCmd
      : ["/sbin/machinen-supervisor", ...supervisorArgs, ...effectiveCmd];

  // env: image defaults overlaid by user + runtime-injected (gvproxy
  // cache mirror, etc.). User + runtime wins on key collision. Shared
  // between the synthesized config.json (read by /init) and the
  // packer's runtime env injection (written into the cpio's
  // env-overlay file).
  const effectiveEnv = { ...imageConfig?.env, ...mergedGuestEnv };

  // Synthesize the bundle directory from the effective cmd + env. No
  // user-authored machinen-config.json; we generate it here and the
  // caller never sees it.
  mkdirSync(join(synthBundleDir, "rootfs"), { recursive: true });
  const configJson = buildMachinenConfig({
    cmd: wrappedCmd,
    env: effectiveEnv,
    guestCwd: opts.guestCwd,
    imageCwd: imageConfig?.cwd,
    liveMounts,
  });
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
    const packT0 = Date.now();
    if (packerOpts.useTiny) {
      // #119: rootDisk path. The on-disk rootfs is mounted from /dev/vda
      // by /init; the cpio only ships /init + machinen-config.json +
      // boot-epoch + /dev/console (~500 KB). The custom kernel
      // (scripts/build-kernel-arm64.sh) has virtio_*, ext4, and vsock
      // built in, so no /modules/*.ko or finit_module pass is needed.
      mkinitramfsPackTinyBundle({
        bundle: synthBundleDir,
        out: cpioPath,
        mount,
        env: effectiveEnv,
        fuseAgentPath: liveMounts.length > 0 ? defaultFuseAgentPath() : undefined,
      });
    } else {
      // Legacy fat cpio: explicit `rootDisk: false` opt-out. Drags the
      // entire base tarball into RAM, by design — callers that need a
      // Debian userland in the cpio (no virtio-blk root) land here.
      mkinitramfsPackBundle({
        bundle: synthBundleDir,
        out: cpioPath,
        base: baseAbs,
        mount,
        env: effectiveEnv,
        fuseAgentPath: liveMounts.length > 0 ? defaultFuseAgentPath() : undefined,
      });
    }
    packerOpts.onPhase?.("cpio-write", Date.now() - packT0);
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

function validateGuestCwd(cwd: string): void {
  if (!cwd || !cwd.startsWith("/")) {
    throw new BootError("BOOT_CWD_INVALID", `guestCwd must be an absolute path (got '${cwd}')`);
  }
  if (cwd.includes("\0")) {
    throw new BootError("BOOT_CWD_INVALID", "guestCwd must not contain NUL bytes");
  }
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
 *
 * Returns a single cmd string. For payloads that would exceed Linux's
 * `MAX_ARG_STRLEN` (128 KB per argv element) once shell-wrapped, use
 * `buildWriteFileCmds` instead — `vm.writeFile()` does.
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

// Linux's `MAX_ARG_STRLEN` caps a single argv element at 32 pages
// (128 KB on 4 KB-page arches). The exec-agent runs cmds via
// `execve("/bin/sh", {"sh","-c",cmd,null}, ...)`, so the whole shell
// pipeline is one argv element. Going over -> execve returns E2BIG ->
// the agent's child falls through to `_exit(127)` and `vm.exec`
// surfaces it as "vm.exec failed (code 127)". 64 KB per chunk leaves
// generous headroom for the surrounding `printf %s '...' >> /tmp/X`
// wrapper while still letting a typical small payload finish in one cmd.
const WRITE_FILE_B64_CHUNK_BYTES = 64 * 1024;

/**
 * Plan the cmd sequence `vm.writeFile()` issues for `contents`.
 * Small payloads (base64 ≤ `WRITE_FILE_B64_CHUNK_BYTES`) collapse to a
 * single cmd identical to `buildWriteFileCmd`'s output. Larger payloads
 * stage the base64 to /tmp in append-chunks and then decode once at the
 * end, so no individual cmd line approaches `MAX_ARG_STRLEN`.
 */
export function buildWriteFileCmds(
  guestPath: string,
  contents: Buffer | string,
  opts: WriteFileOptions = {},
): string[] {
  const buf = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  const b64 = buf.toString("base64");
  if (b64.length <= WRITE_FILE_B64_CHUNK_BYTES) {
    return [buildWriteFileCmd(guestPath, contents, opts)];
  }
  if (opts.mode !== undefined) {
    if (!Number.isInteger(opts.mode) || opts.mode < 0 || opts.mode > 0o7777) {
      throw new RangeError(`writeFile: mode out of range (got ${opts.mode})`);
    }
  }
  const path = shellQuote(guestPath);
  const redir = opts.append ? ">>" : ">";
  // Each cmd in the sequence runs in its own `sh -c`, so `$$` would
  // expand to a different PID per invocation and the chunks would
  // scatter across files. Bake a host-generated suffix into every cmd
  // so they all hit the same staging file.
  const stage = `/tmp/.machinen-wf.${randomBytes(8).toString("hex")}`;
  const cmds: string[] = [];
  const setupParts: string[] = [];
  if (opts.recursive ?? true) {
    setupParts.push(`mkdir -p -- "$(dirname -- ${path})"`);
  }
  setupParts.push(`: > ${stage}`);
  cmds.push(setupParts.join(" && "));
  for (let i = 0; i < b64.length; i += WRITE_FILE_B64_CHUNK_BYTES) {
    const chunk = b64.slice(i, i + WRITE_FILE_B64_CHUNK_BYTES);
    cmds.push(`printf %s ${shellQuote(chunk)} >> ${stage}`);
  }
  const finalParts: string[] = [`base64 -d < ${stage} ${redir} ${path}`, `rm -f ${stage}`];
  if (opts.mode !== undefined) {
    finalParts.push(`chmod ${opts.mode.toString(8).padStart(3, "0")} ${path}`);
  }
  cmds.push(finalParts.join(" && "));
  return cmds;
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

/**
 * Cap on bytes retained per stream by `collect()`. Each VM session keeps
 * the *last* this-many bytes of stdout/stderr; older bytes are dropped.
 * The kernel boot console fits well under this, snapshot debugging only
 * uses the last ~2 KB, and a multi-hour idle VM no longer accumulates
 * gigabytes of console chatter in the supervisor's heap (issue #150).
 */
const CONSOLE_TAIL_BYTES = 1_048_576;

function collect(stream: Readable, capBytes: number = CONSOLE_TAIL_BYTES): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    stream.on("data", (c: Buffer) => {
      chunks.push(c);
      totalBytes += c.length;
      // Drop whole chunks from the head while doing so leaves at least
      // `capBytes` retained. This keeps the ring within [cap, cap +
      // size-of-head-chunk] in steady state, which for line-buffered
      // VMM stderr is comfortably bounded.
      while (chunks.length > 1 && totalBytes - chunks[0].length >= capBytes) {
        totalBytes -= chunks.shift()!.length;
      }
    });
    const finish = () => {
      let merged = Buffer.concat(chunks);
      // If a single oversized chunk pushed us above cap (or we ended
      // up holding more than cap because no head was safe to drop),
      // tail-slice on the way out so the resolved string honors the cap.
      if (merged.length > capBytes) {
        merged = merged.subarray(merged.length - capBytes);
      }
      done(merged.toString("utf8"));
    };
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", fail);
  });
}

// Visible to tests that exercise the ring-buffer logic without booting a VM.
export const _internal = {
  collect,
  CONSOLE_TAIL_BYTES,
  validateMemoryMib,
};

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
  /**
   * Absolute path of the rootfs tarball the source VM was booted with;
   * written into bundle meta.json so `restore()` can default to the
   * same image. Optional because attach handles may be looking at a
   * registry entry that pre-dates `imagePath` tracking.
   */
  sourceImage?: string;
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
  const baseDumpCmd = opts.dumpCmd ?? "/sbin/machinen-dump";
  const deadlineMs = opts.timeoutMs ?? 90_000;
  const onLog = opts.onLog;
  const leaveRunning = opts.leaveRunning === true;
  const tcpClose = opts.tcpClose === true;
  // Env-prefix the dump command. The exec-agent runs commands via
  // `sh -c`, so standard shell `VAR=val cmd` syntax flows unmodified.
  const envPrefix: string[] = [];
  if (tcpClose) {
    envPrefix.push("MACHINEN_DUMP_TCP_CLOSE=1");
  }
  const dumpCmd = envPrefix.length > 0 ? `${envPrefix.join(" ")} ${baseDumpCmd}` : baseDumpCmd;
  const t0 = Date.now();
  // #221: per-phase timeline emitted under DEBUG=machinen:snapshot.
  const phases = new PhaseTimer();
  phases.start("staging");

  // Validate / prepare the bundle directory. We refuse to overwrite an
  // existing populated directory so a previous snapshot can't disappear
  // under a typo'd outDir.
  const snapDir = resolve(opts.outDir);
  if (existsSync(snapDir)) {
    if (!statSync(snapDir).isDirectory()) {
      throw new SnapshotError(
        "SNAPSHOT_DUMP_FAILED",
        `vm.snapshot: outDir exists and is not a directory: ${snapDir}`,
      );
    }
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
  const imgDir = join(snapDir, "img");
  mkdirSync(imgDir, { recursive: true });

  debugSnapshot(
    "snapshot start pid=%d snapDir=%s dumpCmd=%s timeoutMs=%d leaveRunning=%s",
    ctx.pid,
    snapDir,
    dumpCmd,
    deadlineMs,
    leaveRunning,
  );

  if (onLog && ctx.teeGuestConsole) {
    ctx.teeGuestConsole((chunk) => {
      onLog({ source: "guest-console", chunk });
    });
  }
  phases.end("staging");
  phases.start("dump-exec");

  // Spawn the host-side `tar x` that materializes the bundle. The
  // dump script tars its CRIU image directory to stdout; we pump the
  // bytes through this child's stdin. tar logs its own errors on
  // stderr (inherited) which surface in the user's terminal if the
  // stream is malformed.
  const tarChild = nodeSpawn("tar", ["-xmf", "-", "-C", imgDir], {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let tarStderr = "";
  tarChild.stderr.on("data", (chunk: Buffer) => {
    tarStderr += chunk.toString("utf8");
  });
  let tarSpawnError: Error | undefined;
  tarChild.on("error", (err) => {
    tarSpawnError = err;
  });
  const tarExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit) => {
      tarChild.once("exit", (code, signal) => resolveExit({ code, signal }));
    },
  );

  // Pipe vsock-exec stdout chunks (binary tar bytes) into the host
  // tar's stdin. Drop dump-exec stdout from the user-visible onLog
  // stream — those are tar bytes, not log content. Stderr from the
  // dump script (all log lines) still flows to onLog as exec-stderr.
  type DumpOutcome = { kind: "exited"; exitCode: number } | { kind: "rejected"; error: unknown };
  let dumpOutcome: DumpOutcome | undefined;
  const dumpDispatch = ctx
    .execRaw(dumpCmd, {
      // The dump runs against an already-attached, healthy VM, so a
      // long connect timeout is overkill, but 2s was tight enough to
      // reject under load and then get silently swallowed. Bound by
      // the snapshot deadline so a small `timeoutMs` doesn't stall
      // on connect retries.
      connectTimeoutMs: Math.min(deadlineMs, 10_000),
      execTimeoutMs: deadlineMs,
      onStdout: (chunk) => {
        if (tarSpawnError || tarChild.stdin.destroyed) {
          return;
        }
        try {
          tarChild.stdin.write(chunk);
        } catch (err) {
          debugSnapshot(
            "tar stdin write failed: %s",
            err instanceof Error ? err.message : String(err),
          );
        }
      },
      onStderr: onLog
        ? (chunk) => onLog({ source: "exec-stderr", cmd: dumpCmd, chunk })
        : undefined,
    })
    .then(
      (res) => {
        dumpOutcome = { kind: "exited", exitCode: res.exitCode };
        debugSnapshot("dump exec returned exitCode=%d", res.exitCode);
      },
      (err) => {
        dumpOutcome = { kind: "rejected", error: err };
        debugSnapshot(
          "dump exec dispatch rejected: %s",
          err instanceof Error ? err.message : String(err),
        );
      },
    );

  // Race the dump exec against a wall-clock timeout. The dump always
  // runs with --leave-running internally (so the supervisor's wait
  // stays parked while we tar), so the source VM keeps running until
  // the destructive-path poweroff below. Either flavor (leaveRunning
  // or not) needs the dump exec to return on its own.
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    dumpDispatch,
    new Promise<void>((resolveTimer) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolveTimer();
      }, deadlineMs);
      timer.unref();
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }

  // Close tar's stdin so it sees EOF and exits, then wait for it.
  // `tar -x` happily processes a truncated archive (it'll error on
  // the partial member), but our SNAPSHOT_TIMEOUT/SNAPSHOT_DUMP_FAILED
  // checks below will surface the underlying problem regardless.
  if (!tarChild.stdin.destroyed) {
    tarChild.stdin.end();
  }
  const tarResult = await tarExit;
  phases.end("dump-exec");
  phases.start("validation");
  const elapsedMs = Date.now() - t0;
  const consoleLog = await ctx.errorOutput();
  debugSnapshot(
    "dump phase done elapsed=%dms consoleBytes=%d timedOut=%s tarExit=%j dumpOutcome=%j",
    elapsedMs,
    consoleLog.length,
    timedOut,
    tarResult,
    dumpOutcome,
  );

  const dumpHint = formatDumpOutcomeHint(dumpOutcome);
  const tail = consoleLog ? `\nConsole tail:\n${consoleLog.slice(-2000)}` : "";

  if (timedOut) {
    // Source VM is still up (--leave-running). Don't kill it — caller
    // can retry or kill manually. We just report the failure.
    throw new SnapshotError(
      "SNAPSHOT_TIMEOUT",
      `vm.snapshot: dump exec did not return within ${deadlineMs}ms — dump likely failed.` +
        dumpHint +
        tail,
    );
  }
  if (!dumpOutcome) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: dump exec produced no outcome — dispatch raced the timeout.",
    );
  }
  if (dumpOutcome.kind === "rejected" || dumpOutcome.exitCode !== 0) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: dump exec failed." + dumpHint + tail,
    );
  }
  if (tarSpawnError || tarResult.code !== 0) {
    const tarErr = tarSpawnError
      ? `\nHost tar spawn failed: ${tarSpawnError.message}`
      : `\nHost tar exited code=${tarResult.code} signal=${tarResult.signal}.${
          tarStderr ? ` stderr:\n${tarStderr.slice(-1000)}` : ""
        }`;
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: failed to extract bundle on the host." + tarErr + tail,
    );
  }

  // Sanity-check the materialized bundle: we expect at least one
  // core-*.img (CRIU produces one per task). An empty img/ means the
  // dump script ran but didn't actually dump anything (e.g. caller
  // pointed dumpCmd at /usr/bin/true).
  const imgEntries = readdirSync(imgDir);
  if (!imgEntries.some((name) => /^core-\d+\.img$/.test(name))) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      `vm.snapshot: bundle has no core-*.img — the dump script likely never ran.` + dumpHint + tail,
    );
  }

  // Destructive snapshot: the source VM is still alive (we always
  // pass --leave-running internally). Bring it down via a clean
  // poweroff so callers see the same "VM is gone after snapshot"
  // semantics as before. Fork (leaveRunning: true) skips this.
  if (!leaveRunning) {
    phases.start("poweroff");
    debugSnapshot("issuing /sbin/machinen-poweroff to bring VMM down");
    // Fire-and-forget: poweroff triggers PSCI SYSTEM_OFF which kills
    // the VMM, which closes vsock — the exec usually rejects or
    // returns with no exit code. Either is fine.
    ctx
      .execRaw("/sbin/machinen-poweroff", {
        connectTimeoutMs: Math.min(deadlineMs, 5_000),
        execTimeoutMs: 10_000,
      })
      .catch((err) => {
        debugSnapshot(
          "poweroff exec rejected (expected): %s",
          err instanceof Error ? err.message : String(err),
        );
      });
    // Wait for the VMM to actually exit. Bound by the same deadline
    // so a stuck guest doesn't hang the snapshot indefinitely.
    const powerOffTimer = setTimeout(() => {
      debugSnapshot("poweroff deadline fired — SIGKILLing VMM");
      void ctx.kill();
    }, deadlineMs);
    powerOffTimer.unref();
    try {
      await ctx.wait();
    } finally {
      clearTimeout(powerOffTimer);
    }
    phases.end("poweroff");
  }

  phases.end("validation");
  phases.start("finalize");

  // Drop the bundle metadata next to the images so `restore({ snapDir })`
  // can recover the source name and rootfs path without poking at the
  // disk. `sourceImage` is the absolute host path to the tarball the
  // source VM booted from — restore uses it as the default rootfs so
  // CRIU can re-open file-backed VMAs (executable, libraries) at the
  // paths they were dumped from. Cross-host restores still need the
  // path to resolve on the new host (or `--image` to override).
  const meta: SnapshotMeta = {
    sourceName: ctx.sourceName,
    sourceImage: ctx.sourceImage,
    snappedAt: Date.now(),
  };
  writeFileSync(join(snapDir, "meta.json"), JSON.stringify(meta));
  phases.end("finalize");

  debugSnapshot("snapshot done snapDir=%s imgEntries=%d", snapDir, imgEntries.length);
  phases.flush(debugSnapshot, "snapshot");
  return { snapDir, imgDir, elapsedMs, consoleLog };
}

function formatDumpOutcomeHint(
  outcome: { kind: "exited"; exitCode: number } | { kind: "rejected"; error: unknown } | undefined,
): string {
  if (!outcome) {
    return "";
  }
  if (outcome.kind === "rejected") {
    const err = outcome.error;
    const msg = err instanceof Error ? err.message : String(err);
    return `\nDump exec dispatch failed: ${msg}`;
  }
  if (outcome.exitCode !== 0) {
    return `\nDump exec exited ${outcome.exitCode} (workload kept running).`;
  }
  return "";
}

export interface RestoreOptions extends Omit<BootOptions, "snapshot" | "image" | "cmd" | "name"> {
  /**
   * Snapshot bundle directory produced by `vm.snapshot()`.
   * Must contain `img/<crius>` and `meta.json`.
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
  /**
   * Restore via CRIU lazy-pages with the bundle vsock-FUSE-mounted
   * read-only into the guest (#266). Pages flow into the workload's
   * anon mappings only when faulted, streaming from the host bundle
   * on demand — host RSS is proportional to the touched set rather
   * than the full snapshot size. Default false (eager restore).
   */
  lazyPages?: boolean;
}

/**
 * Restore a microVM from a snapshot bundle produced by
 * `vm.snapshot({ outDir })`. Reads the bundle's `meta.json` to
 * recover the source name, tars the CRIU image directory into a
 * temporary archive, then `boot()`s with that archive attached as
 * the scratch block device — the guest's `/sbin/machinen-restore`
 * untars `/dev/vdb` into tmpfs and runs `criu restore` against the
 * extracted images.
 *
 * The boot knobs:
 *
 *   - `snapshot: <tar>`     attaches the bundle archive as /dev/vdb
 *   - `name: <sourceName>/<pid>`  auto-named fork (unless caller
 *                                 passed `name`)
 *   - `forkedFrom: <snapDir>`     lineage for `machinen ls`
 *
 * @throws {BootError} BOOT_SNAPSHOT_NOT_FOUND if `<snapDir>/img/`
 *   is missing or empty.
 */
export async function restore(opts: RestoreOptions): Promise<VmHandle> {
  // #221: per-phase timeline for restore. Boot's own phases get logged
  // separately under DEBUG=machinen:boot — restore tracks the parts
  // that are restore-specific (meta-read, the boot rollup, and the
  // wall-clock until the restored guest is responsive over vsock).
  const phases = new PhaseTimer();
  const snapDir = resolve(opts.snapDir);
  const imgDir = join(snapDir, "img");
  const metaPath = join(snapDir, "meta.json");
  if (!existsSync(imgDir) || !statSync(imgDir).isDirectory()) {
    throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", `restore: ${imgDir} not found`);
  }
  const imgEntries = readdirSync(imgDir);
  if (!imgEntries.some((name) => /^core-\d+\.img$/.test(name))) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: ${imgDir} has no core-*.img — is this a snapshot bundle?`,
    );
  }
  phases.start("snapshot-meta-read");
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
  phases.end("snapshot-meta-read");

  // Resolve the rootfs image: caller's `opts.image` wins; otherwise
  // fall back to the path the source booted from (recorded in
  // meta.json). Without a usable image, criu's file-backed VMA
  // restore has nothing to reopen and PID 1 panics — so we throw
  // here with a message the user can act on instead.
  let resolvedImage: string | undefined;
  if (opts.image) {
    resolvedImage = resolve(opts.cwd ?? process.cwd(), opts.image);
    if (!existsSync(resolvedImage)) {
      throw new BootError("BOOT_IMAGE_NOT_FOUND", `restore: image not found: ${resolvedImage}`);
    }
  } else if (meta.sourceImage && existsSync(meta.sourceImage)) {
    resolvedImage = meta.sourceImage;
    debugRestore("using meta.sourceImage path=%s", resolvedImage);
  } else if (meta.sourceImage) {
    // The bundle remembers a path, but it's gone on this host (e.g.
    // restored on a different machine, or the tarball was deleted).
    // Surface it so the user can scp it over or pass --image.
    throw new BootError(
      "BOOT_IMAGE_NOT_FOUND",
      `restore: source image not found at ${meta.sourceImage}\n` +
        `  The snapshot was taken with this rootfs tarball, and CRIU needs\n` +
        `  it to reopen the process's file-backed memory mappings (e.g.\n` +
        `  /usr/bin/node, libc, etc).\n` +
        `  • copy the tarball to that path on this host, OR\n` +
        `  • pass an explicit override via the runtime's restore({ image })\n` +
        `    or the CLI's \`machinen restore --image <tarball>\`.`,
    );
  } else {
    // No --image, and the bundle's meta.json has no sourceImage (an
    // old bundle predating this field, or one written without the
    // source's image path). Without something to mount as /, criu
    // can't reopen file-backed VMAs. Tell the user up front.
    throw new BootError(
      "BOOT_IMAGE_NOT_FOUND",
      `restore: no rootfs image available for this bundle.\n` +
        `  The snapshot's meta.json doesn't record a source image (likely\n` +
        `  predates the field). Pass the same tarball you booted the\n` +
        `  source VM with via the runtime's restore({ image }) or the\n` +
        `  CLI's \`machinen restore --image <tarball>\`.`,
    );
  }

  // Lazy-pages mode (#266): mark every PE_PRESENT pagemap entry that
  // lives in an anon-private VMA with PE_LAZY in place on the host
  // before boot, so `criu restore --lazy-pages` actually registers
  // UFFD on those entries instead of loading them eagerly. Dumps are
  // taken without `--lazy-pages` (machinen-dump.sh keeps the dump
  // path simple); without this rewrite the lazy-pages daemon would
  // see no lazy entries and load the whole image up front. Idempotent.
  // See packages/runtime/src/lazy-pagemap.ts.
  if (opts.lazyPages) {
    phases.start("snapshot-mark-lazy");
    const marked = markPagemapsLazy(imgDir);
    debug(
      "lazy-pages mark: files=%d entriesFlagged=%d alreadyLazy=%d",
      marked.filesRewritten,
      marked.entriesFlagged,
      marked.entriesAlreadyLazy,
    );
    phases.end("snapshot-mark-lazy");
  }

  // Bundle delivery split by mode:
  //   - lazyPages: vsock-FUSE-mount `imgDir/` read-only at /mnt/snap-src/img.
  //     CRIU restore reads pagemap-*.img + pages-*.img directly through FUSE;
  //     bytes stream from the host on demand and never materialize in guest
  //     tmpfs. This is the #266 path — it removes the duplicate-copy that
  //     was eating ~workload-size of guest RAM.
  //   - eager (default): pack `imgDir/` into a tar archive attached as
  //     /dev/vdb. The guest's machinen-restore.sh untars into tmpfs and
  //     CRIU does an eager load. We keep this path for non-lazy restores
  //     because every pread through FUSE costs a vsock round-trip; eager
  //     restore is many MB of preadv calls and would slow the restore.
  phases.start("snapshot-pack");
  const restoreEnv: Record<string, string> = {};
  let scratchPath: string;
  let liveMounts: Array<{ host: string; guest: string; mode?: "ro" | "rw" }> | undefined;
  if (opts.lazyPages) {
    scratchPath = join(
      tmpdir(),
      `machinen-restore-scratch-${process.pid}-${randomBytes(6).toString("hex")}.img`,
    );
    allocateSparseFile(scratchPath, SNAP_SCRATCH_BYTES);
    restoreEnv.MACHINEN_RESTORE_BUNDLE_LIVE = "1";
    restoreEnv.MACHINEN_RESTORE_LAZY_PAGES = "1";
    liveMounts = [
      ...(opts.liveMounts ?? []),
      { host: imgDir, guest: "/mnt/snap-src/img", mode: "ro" as const },
    ];
  } else {
    // Pack the bundle into a tar so machinen-restore.sh can untar it
    // off /dev/vdb. tar is `bsdtar` on darwin and `gnu tar` on linux;
    // both produce archives the guest's `tar -xmf` reads. The trailing
    // sparse extension keeps /dev/vdb at SNAP_SCRATCH_BYTES so chained
    // `vm.snapshot()` against this VM has scratch room (its mkfs.ext4
    // happily ignores tar bytes at the front).
    scratchPath = join(
      tmpdir(),
      `machinen-restore-bundle-${process.pid}-${randomBytes(6).toString("hex")}.tar`,
    );
    try {
      execFileSync("tar", ["-cf", scratchPath, "-C", imgDir, "."]);
      const fd = openSync(scratchPath, "r+");
      try {
        const buf = Buffer.alloc(1);
        writeSync(fd, buf, 0, 1, SNAP_SCRATCH_BYTES - 1);
      } finally {
        closeSync(fd);
      }
    } catch (err) {
      try {
        unlinkSync(scratchPath);
      } catch {}
      throw new BootError(
        "BOOT_SNAPSHOT_NOT_FOUND",
        `restore: failed to pack bundle from ${imgDir}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    liveMounts = opts.liveMounts;
  }
  phases.end("snapshot-pack");

  // boot() doesn't know the pid until after the VMM is spawned, so
  // we can't pass `<sourceName>/<pid>` up front. Boot anonymous,
  // then claim the auto-name and patch the registry entry below.
  phases.start("boot");
  let vm: VmHandle;
  try {
    vm = await boot({
      ...opts,
      image: resolvedImage,
      snapshot: scratchPath,
      forkedFrom: snapDir,
      name: opts.name,
      liveMounts,
      env: { ...opts.env, ...restoreEnv },
    });
  } finally {
    // boot() reflink-clones the source into a per-boot path before
    // attaching, so the source scratch/tar isn't needed after boot
    // returns. Clean up regardless of success.
    try {
      unlinkSync(scratchPath);
    } catch {}
  }
  phases.end("boot");

  if (!opts.name && meta.sourceName) {
    // Default auto-name nests under the source: `<src>/<pid>`.
    // claimName refuses (returns false) when `<src>` exists as a live
    // pin file blocking the parent dir — the fork case (#216), where
    // the source VM is still running. In that case fall back to a
    // flat sibling name `<src>~<pid>` so the fork still gets a
    // meaningful auto-id in `machinen ls`.
    const candidates = [`${meta.sourceName}/${vm.pid}`, `${meta.sourceName}~${vm.pid}`];
    for (const candidate of candidates) {
      if (claimName(candidate, vm.pid)) {
        // Promote the registry entry to carry the auto-name.
        const cur = findEntry({ pid: vm.pid });
        if (cur) {
          writeEntry({ ...cur, name: candidate });
        }
        // Mutate the handle so `vm.name` reflects the resolved name.
        (vm as { name?: string }).name = candidate;
        break;
      }
    }
  }

  // CRIU restores the dumped UTS namespace, which means the hostname
  // is whatever the source VM had — not the new VM's identity. Fire
  // `hostname <label>` over vsock (fire-and-forget) so the guest's
  // kernel hostname uniquely identifies this VM, with the host VMM
  // pid as the disambiguator. See buildGuestHostname for the format.
  //
  // #221: piggy-back on the same vsock round-trip to time how long
  // CRIU restore + supervisor takes to become responsive. Anything
  // that lets the hostname call return is a usable proxy for "guest
  // ready". We don't await it — boot() already happened, this just
  // closes the timing line in the background.
  phases.start("criu-restore-probe");
  void setGuestHostname(vm, buildGuestHostname(vm.pid, vm.name)).finally(() => {
    phases.end("criu-restore-probe");
    phases.flush(debugRestore, "restore");
  });
  return vm;
}

// =============================================================
// Fork — #216
// =============================================================

/**
 * Build the kernel hostname we set on the guest. Always includes the
 * host VMM pid so each running VM has a unique label, even when the
 * caller didn't pass a name. Format:
 *   - named:    `<name>-pid-<host_pid>`
 *   - nameless: `vm-pid-<host_pid>`
 *
 * Sanitizes the name component (replaces anything outside the POSIX
 * hostname charset with `-`) so an auto-name like `<src>~<pid>` or
 * `<src>/<pid>` becomes a valid hostname instead of being rejected.
 */
function buildGuestHostname(pid: number, name?: string): string {
  const tag = `pid-${pid}`;
  if (!name) {
    return `vm-${tag}`;
  }
  // RFC 952/1123: letters, digits, hyphen. Map everything else to `-`,
  // collapse runs of `-`, and trim leading/trailing `-`.
  const safe = name
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe.length > 0 ? `${safe}-${tag}` : `vm-${tag}`;
}

/**
 * Set the guest's kernel hostname over vsock-exec. Fire-and-forget:
 * any failure is logged at debug level and swallowed — a wrong prompt
 * label is strictly cosmetic and must never break a boot/restore.
 *
 * Note for callers chasing prompt updates: bash's `\h` reads
 * `gethostname()` once at shell startup and caches it. Restored
 * (CRIU) shells and shells already running before this call won't
 * pick up the change in their prompt — the kernel value updates,
 * but the live shell needs `exec bash` (or a new shell via
 * `machinen attach`) to re-read.
 */
async function setGuestHostname(vm: VmHandle, hostname: string): Promise<void> {
  if (
    hostname.length === 0 ||
    hostname.includes("'") ||
    hostname.includes("\n") ||
    hostname.includes("\0")
  ) {
    debug("setGuestHostname: refusing unsafe hostname %j", hostname);
    return;
  }
  try {
    // execRaw doesn't throw on non-zero exit; we just don't care
    // either way. 5s connectTimeout covers slow boot agent bring-up
    // without dragging caller latency.
    await vm.execRaw(`hostname '${hostname}' 2>/dev/null || true`, {
      connectTimeoutMs: 5_000,
      execTimeoutMs: 5_000,
    });
    debug("setGuestHostname: set pid=%d hostname=%s", vm.pid, hostname);
  } catch (err) {
    debug(
      "setGuestHostname: failed pid=%d hostname=%s err=%s",
      vm.pid,
      hostname,
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Snapshot the VM with --leave-running, immediately restore the
 * bundle into a sibling, and (optionally) clean up the bundle when
 * the fork exits. Shared between boot-owned and attach-owned handles.
 *
 * Bundle lifecycle:
 *   - opts.outDir set:    bundle stays at that path; caller owns cleanup.
 *   - opts.outDir absent: bundle in a temp dir, removed on fork.wait().
 */
async function performFork(ctx: SnapshotContext, opts: ForkOptions): Promise<VmHandle> {
  const ephemeral = !opts.outDir;
  const snapDir = opts.outDir
    ? resolve(opts.outDir)
    : mkdtempSync(join(tmpdir(), "machinen-fork-"));
  debugFork(
    "fork start srcPid=%d srcName=%s snapDir=%s ephemeral=%s tcpKeep=%s",
    ctx.pid,
    ctx.sourceName ?? "<unset>",
    snapDir,
    ephemeral,
    opts.tcpKeep === true,
  );

  // Snapshot half: source survives. tcpClose flips the spec's default.
  // Uses performSnapshot's own 90s default ceiling — the dump half is
  // not user-configurable through ForkOptions today.
  let snap: SnapshotResult;
  try {
    snap = await performSnapshot(ctx, {
      outDir: snapDir,
      leaveRunning: true,
      tcpClose: opts.tcpKeep !== true,
      onLog: opts.onLog,
    });
  } catch (err) {
    // Don't leave an empty temp dir behind on snapshot failure.
    if (ephemeral) {
      try {
        rmSync(snapDir, { recursive: true, force: true });
      } catch {}
    }
    throw err;
  }
  debugFork("fork dump complete elapsedMs=%d", snap.elapsedMs);

  // Restore half: a fresh sibling VM. boot() inside restore() auto-
  // allocates its own vsock UDS and (if needed) gvproxy — vsock
  // identity and L2 networking are isolated per-VM.
  //
  // Strip the two fork-only fields (outDir, tcpKeep) and forward the
  // rest of `opts` straight to restore(). This is the "fork = snapshot
  // + restore, no diverging path" surface: every BootOptions field the
  // user could pass at boot time also works on a fork (mount,
  // liveMounts, env, guestCwd, memory, kernel, dtb, …) and lands on
  // the restored sibling.
  //
  // Two invariants we preserve regardless of caller input:
  //   - portForward: NOT inherited from source. Host ports are global,
  //     so source + fork would race on the same bind. Caller must
  //     re-declare any forwards they want on the fork.
  //   - pdeathsig: forced false. The fork outlives the process that
  //     spawned it (CLI returns immediately; programmatic callers
  //     detach()). The parent-death shim would SIGTERM the fork on
  //     CLI exit otherwise.
  //   - timeoutMs: defaults to null (forever) instead of boot()'s 60s.
  //     Forks are long-lived siblings; an idle interactive console
  //     would otherwise be reaped mid-shell. Caller can override.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { outDir: _outDir, tcpKeep: _tcpKeep, ...restoreOpts } = opts;
  let fork: VmHandle;
  try {
    fork = await restore({
      ...restoreOpts,
      snapDir,
      portForward: opts.portForward ?? [],
      pdeathsig: false,
      timeoutMs: opts.timeoutMs ?? null,
    });
  } catch (err) {
    if (ephemeral) {
      try {
        rmSync(snapDir, { recursive: true, force: true });
      } catch {}
    }
    throw err;
  }
  debugFork("fork restored pid=%d name=%s", fork.pid, fork.name ?? "<unset>");

  if (ephemeral) {
    void fork
      .wait()
      .catch(() => {})
      .finally(() => {
        try {
          rmSync(snapDir, { recursive: true, force: true });
          debugFork("fork ephemeral bundle cleaned up snapDir=%s", snapDir);
        } catch (cleanupErr) {
          debugFork(
            "fork ephemeral cleanup failed snapDir=%s err=%s",
            snapDir,
            cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
          );
        }
      });
  }
  return fork;
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
