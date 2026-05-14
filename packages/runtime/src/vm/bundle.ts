// Bundle / live-mount plumbing for `boot()` and `restore()`. Owns:
//   - validation + normalization of caller-supplied liveMounts,
//   - synthesis of the machinen-config.json /init reads at boot,
//   - the merge between snapshot-recorded liveMounts and restore-time
//     overrides,
//   - `synthesizeAndPackBundle`: stage the synthetic bundle, run the
//     mkinitramfs packer, and prepare the virtio-blk mount-disk inputs.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { BootError } from "../errors.ts";
import {
  defaultFuseAgentPath,
  packBundle as mkinitramfsPackBundle,
  packTinyBundle as mkinitramfsPackTinyBundle,
} from "../mkinitramfs.ts";
import {
  ensureMountDiskImage,
  ensureMountDiskUpper,
  markMountDiskImageClean,
} from "../mountdisk-img.ts";
import { reflinkCopy } from "../reflink.ts";
import type { BootOptions } from "./boot.ts";
import type { SnapshotMeta } from "../vm-handle.ts";
import { normalizeMountGuest, validateGuestCwd, validateMountGuest } from "./helpers.ts";
import { readImageConfig } from "./image-config.ts";

/**
 * A caller-provided `liveMounts` entry after validation, with the
 * vsock port + host UDS path allocated. Threaded from `boot()` into
 * the initramfs packer so the config and the host servers agree on
 * ports and guest paths.
 */
export interface ResolvedLiveMount {
  host: string;
  guest: string;
  port: number;
  udsPath: string;
  /**
   * Per-mount stats file the detached helper writes its
   * bytesServedOnPagesImg counter to. Lives next to `udsPath` under
   * `vsockTempDir` so the supervisor's cleanupPaths sweep covers it.
   */
  statsPath: string;
  mode: "ro" | "rw";
}

/** Base vsock port for live mounts. Chosen below the exec/file/
 *  secrets/winsize agent band (1975–1978) so it doesn't collide. */
const LIVE_MOUNT_PORT_BASE = 1970;

export function resolveLiveMounts(
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
      statsPath: join(udsDir, `live-mount-${i}-stats.json`),
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

/**
 * #273: merge a snapshot bundle's recorded live-mount config with
 * caller-provided per-guest overrides into the effective list
 * `restore()` hands to `boot()`. Pure — extracted so the override
 * semantics can be unit-tested without booting a VM.
 *
 * Semantics:
 *   - `recorded` empty / undefined: legacy bundle (predates #273) —
 *     forward `overrides` as-is so existing additive callers keep
 *     working. Returns undefined when both inputs are empty.
 *   - `recorded` non-empty: each entry is re-established by default.
 *     For each entry in `overrides`, the matching `recorded` entry's
 *     `host` and (optionally) `mode` are replaced. An override whose
 *     `guest` doesn't appear in `recorded` is rejected with
 *     BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN — the override knob is for
 *     remapping bundle-recorded mounts, not for adding new ones.
 *
 * @internal exported for tests
 */
export function resolveRestoreLiveMounts(
  recorded: SnapshotMeta["liveMounts"] | undefined,
  overrides: BootOptions["liveMounts"] | undefined,
): BootOptions["liveMounts"] {
  const recordedList = recorded ?? [];
  const overrideList = overrides ?? [];
  if (recordedList.length === 0) {
    return overrideList.length > 0 ? overrideList : undefined;
  }
  const recordedByGuest = new Map(recordedList.map((m) => [m.guest, m]));
  const overridesByGuest = new Map<string, { host: string; guest: string; mode?: "ro" | "rw" }>();
  for (const ov of overrideList) {
    if (!recordedByGuest.has(ov.guest)) {
      const known = recordedList.map((m) => m.guest).join(", ");
      throw new BootError(
        "BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN",
        `restore: liveMounts override for guest=${ov.guest} doesn't match any\n` +
          `  liveMount recorded in the bundle. The bundle's recorded guest paths are:\n` +
          `    ${known}\n` +
          `  restore() reproduces the snapshot's mount topology — opts.liveMounts is\n` +
          `  an override map, not an additive list. To override, set 'guest' to one\n` +
          `  of the recorded paths above and supply a new 'host' / 'mode'.`,
      );
    }
    overridesByGuest.set(ov.guest, ov);
  }
  return recordedList.map((rec) => {
    const ov = overridesByGuest.get(rec.guest);
    return ov
      ? { guest: rec.guest, host: ov.host, mode: ov.mode ?? rec.mode }
      : { guest: rec.guest, host: rec.host, mode: rec.mode };
  });
}

export function synthesizeAndPackBundle(
  opts: BootOptions,
  mergedGuestEnv: Record<string, string>,
  liveMounts: ResolvedLiveMount[],
  packerOpts: {
    useTiny: boolean;
    env: Record<string, string>;
    mountDiskUpperSizeBytes?: number;
    onPhase?: (name: string, ms: number) => void;
  },
): {
  tempDir: string;
  cpioPath: string;
  mountDisk?: {
    lowerPath: string;
    upperPath: string;
    guest: string;
    upperSizeBytes: number;
  };
} {
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
  } else if (opts._snapletRestorePath) {
    // Snaplet restore: the VMM overwrites guest RAM with the bundle's
    // whole-VM `.snaplet` state before the first vCPU run, so /init
    // never executes and the cmd is moot — but the VMM still needs a
    // valid initramfs (MACHINEN_INITRD is required). Give it a
    // harmless placeholder that's guaranteed present in the rootfs
    // and, like the criu restore helper, takes precedence over the
    // image's baked-in cmd (which would otherwise launch a fresh
    // workload instead of resuming the snapshotted one).
    effectiveCmd = ["/sbin/machinen-poweroff"];
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
      // (scripts/build-kernel-arm64.sh) has virtio_*, ext4, vsock,
      // squashfs, and overlayfs built in, so no /modules/*.ko or
      // finit_module pass is needed.
      //
      // #272: the `--mount` payload no longer rides in the cpio. We
      // pass `mountGuest` so /init learns the target path; the actual
      // bytes ride on virtio-blk slots 5+6 (set up further down in
      // boot()).
      mkinitramfsPackTinyBundle({
        bundle: synthBundleDir,
        out: cpioPath,
        // The cpio just carries the guest mountpoint string for /init
        // to read. The actual payload (whether materialized fresh or
        // sourced from a snapshot bundle) rides on virtio-blk slots
        // 5+6, attached further down in boot().
        mountGuest: mount?.guest ?? opts._restoreMountDisk?.guest,
        env: effectiveEnv,
        fuseAgentPath: liveMounts.length > 0 ? defaultFuseAgentPath() : undefined,
      });
    } else {
      // Legacy fat cpio: explicit `rootDisk: false` opt-out. Drags the
      // entire base tarball into RAM, by design — callers that need a
      // Debian userland in the cpio (no virtio-blk root) land here.
      // The legacy cpio overlay path is preserved here: this branch
      // does not get the virtio-blk mount overlay, since the kernel
      // would have to wait for the rootdisk pivot anyway.
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
  // #272: the rootDisk path also needs the squashfs+ext4 payload
  // built and fd-passed to the VMM. Two paths:
  //   - fresh boot with `mount`: materialize a content-addressed
  //     squashfs lower from the host source dir + a per-VM ext4 upper.
  //   - restore from a snapshot bundle (`_restoreMountDisk`): reuse
  //     the bundle's lower as-is (it's already content-addressed and
  //     immutable), but reflink the bundle's upper into a per-VM
  //     path so guest writes don't mutate the bundle in-place.
  //
  // Materialize here so a missing mksquashfs fails fast at boot rather
  // than mid-spawn.
  let mountDisk:
    | { lowerPath: string; upperPath: string; guest: string; upperSizeBytes: number }
    | undefined;
  if (packerOpts.useTiny) {
    if (opts._restoreMountDisk) {
      try {
        const r = opts._restoreMountDisk;
        if (!existsSync(r.lowerPath)) {
          throw new BootError(
            "BOOT_SNAPSHOT_NOT_FOUND",
            `restore: bundle is missing mount-lower at ${r.lowerPath}`,
          );
        }
        if (!existsSync(r.upperPath)) {
          throw new BootError(
            "BOOT_SNAPSHOT_NOT_FOUND",
            `restore: bundle is missing mount-upper at ${r.upperPath}`,
          );
        }
        // Reflink the upper so writes accumulate per-fork instead of
        // mutating the bundle. APFS clonefile / Linux FICLONE on
        // capable fs (free, shared blocks until guest writes); falls
        // back to a regular copy elsewhere.
        const perVMUpper = join(
          tmpdir(),
          `machinen-mountdisk-upper-${process.pid}-${randomBytes(6).toString("hex")}.img`,
        );
        reflinkCopy(r.upperPath, perVMUpper);
        const upperSize = statSync(perVMUpper).size;
        mountDisk = {
          lowerPath: r.lowerPath,
          upperPath: perVMUpper,
          guest: r.guest,
          upperSizeBytes: upperSize,
        };
      } catch (err) {
        cleanup();
        throw err;
      }
    } else if (mount) {
      try {
        const lower = ensureMountDiskImage(mount.host, {
          onPhase: (name, ms) => packerOpts.onPhase?.(`mountdisk.${name}`, ms),
        });
        // markMountDiskImageClean is idempotent and safe to call here —
        // we only READ the cached file; the per-boot boot() flow takes
        // ownership of the .ok marker via the same lifecycle the
        // rootdisk uses.
        const upper = ensureMountDiskUpper({
          sizeBytes: packerOpts.mountDiskUpperSizeBytes,
        });
        mountDisk = {
          lowerPath: lower.lowerPath,
          upperPath: upper.upperPath,
          guest: mount.guest,
          upperSizeBytes: upper.sizeBytes,
        };
        markMountDiskImageClean(lower.lowerPath);
      } catch (err) {
        cleanup();
        throw err;
      }
    }
  }
  return { tempDir, cpioPath, mountDisk };
}
