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
  packBundle as mkinitramfsPackBundle,
  packTinyBundle as mkinitramfsPackTinyBundle,
} from "../mkinitramfs.ts";
import {
  ensureMountDiskImage,
  ensureMountDiskUpper,
  markMountDiskImageClean,
} from "../mountdisk-img.ts";
import { reflinkCopy } from "../reflink.ts";
import {
  planBootBundleCommandNative,
  planBootLiveMountsNative,
  planBootMachinenConfigNative,
} from "../native/boot-plan.ts";
import type { BootOptions } from "./boot.ts";
import type { SnapshotMeta } from "../vm-handle.ts";
import { normalizeMountGuest, validateGuestCwd, validateMountGuest } from "./helpers.ts";
import { readImageConfig } from "./image-config.ts";

/**
 * A caller-provided `liveMounts` entry after validation. Served by an
 * in-VMM virtio-fs device (#332) — no detached process, no vsock port,
 * no guest fuse-agent. `tag` is the device's config-space identifier;
 * `/init` runs `mount -t virtiofs <tag> <guest>`. Threaded from
 * `boot()` into the initramfs packer so the config and the VMM env
 * agree on guest paths and per-mount tags.
 */
export interface ResolvedLiveMount {
  host: string;
  guest: string;
  mode: "ro" | "rw";
  tag: string;
}

export function resolveLiveMounts(
  mounts: Array<{
    host: string;
    guest: string;
    mode?: "ro" | "rw";
  }>,
  cwd: string | undefined,
): ResolvedLiveMount[] {
  const planned = planBootLiveMountsNative(mounts);
  return planned.map((mount, i) => {
    const hostAbs = resolve(cwd ?? process.cwd(), mount.host);
    if (!existsSync(hostAbs)) {
      throw new BootError(
        "BOOT_MOUNT_HOST_NOT_FOUND",
        `liveMounts[${i}] host path not found: ${mount.host}`,
      );
    }
    if (!statSync(hostAbs).isDirectory()) {
      throw new BootError(
        "BOOT_MOUNT_INVALID",
        `liveMounts[${i}] host path must be a directory: ${mount.host}`,
      );
    }
    rejectRemovedLiveMountOptions(mounts[i] ?? {}, i);
    return { ...mount, host: hostAbs };
  });
}

function rejectRemovedLiveMountOptions(mount: object, index: number): void {
  if ("cache" in mount) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      `liveMounts[${index}] cache is no longer supported; metadata caching uses the fast policy`,
    );
  }
  if ("sync" in mount) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      `liveMounts[${index}] sync is no longer supported; rw live mounts sync in batches`,
    );
  }
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
  return planBootMachinenConfigNative(input);
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
 *     `host` and optional `mode` are replaced. An override whose `guest`
 *     doesn't appear in `recorded` is rejected with
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
  overrideList.forEach((ov, i) => rejectRemovedLiveMountOptions(ov, i));
  if (recordedList.length === 0) {
    return overrideList.length > 0 ? overrideList : undefined;
  }
  const recordedByGuest = new Map(recordedList.map((m) => [m.guest, m]));
  const overridesByGuest = new Map<
    string,
    {
      host: string;
      guest: string;
      mode?: "ro" | "rw";
    }
  >();
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
      ? {
          guest: rec.guest,
          host: ov.host,
          mode: ov.mode ?? rec.mode,
        }
      : { guest: rec.guest, host: rec.host, mode: rec.mode };
  });
}

type BundleMountDisk = {
  lowerPath: string;
  upperPath: string;
  guest: string;
  upperSizeBytes: number;
};

interface BundlePackerOptions {
  useTiny: boolean;
  env: Record<string, string>;
  mountDiskUpperSizeBytes?: number;
  onPhase?: (name: string, ms: number) => void;
}

interface SynthesizedBundle {
  tempDir: string;
  cpioPath: string;
  mountDisk?: BundleMountDisk;
}

interface BundleWorkspace {
  tempDir: string;
  cpioPath: string;
  synthBundleDir: string;
  cleanup: () => void;
}

interface BundleImageConfig {
  cmd?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface BundleImageInput {
  baseAbs: string | undefined;
  imageConfig: BundleImageConfig | undefined;
}

interface ResolvedMountInput {
  host: string;
  guest: string;
}

export function synthesizeAndPackBundle(
  opts: BootOptions,
  mergedGuestEnv: Record<string, string>,
  liveMounts: ResolvedLiveMount[],
  packerOpts: BundlePackerOptions,
): SynthesizedBundle {
  const workspace = createBundleWorkspace();
  try {
    validateOptionalGuestCwd(opts);
    const image = resolveBundleImage(opts, packerOpts);
    const cmd = planBundleCommand(opts, image.imageConfig, liveMounts);
    const effectiveEnv = { ...image.imageConfig?.env, ...mergedGuestEnv };
    writeBundleConfig(workspace, {
      cmd,
      env: effectiveEnv,
      guestCwd: opts.guestCwd,
      imageCwd: image.imageConfig?.cwd,
      liveMounts,
    });
    const mount = resolveBundleMount(opts);
    packSynthesizedInitramfs(workspace, image.baseAbs, mount, opts, effectiveEnv, packerOpts);
    return {
      tempDir: workspace.tempDir,
      cpioPath: workspace.cpioPath,
      mountDisk: materializeBundleMountDisk(opts, mount, packerOpts),
    };
  } catch (err) {
    workspace.cleanup();
    throw err;
  }
}

function createBundleWorkspace(): BundleWorkspace {
  const tempDir = mkdtempSync(join(tmpdir(), "machinen-bundle-"));
  return {
    tempDir,
    cpioPath: join(tempDir, "initramfs.cpio"),
    synthBundleDir: join(tempDir, "bundle"),
    cleanup: () => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

function validateOptionalGuestCwd(opts: BootOptions): void {
  if (opts.guestCwd !== undefined) {
    validateGuestCwd(opts.guestCwd);
  }
}

function resolveBundleImage(opts: BootOptions, packerOpts: BundlePackerOptions): BundleImageInput {
  if (!opts.image) {
    return { baseAbs: undefined, imageConfig: undefined };
  }
  const baseAbs = resolve(opts.cwd ?? process.cwd(), opts.image);
  if (!existsSync(baseAbs)) {
    throw new BootError("BOOT_IMAGE_NOT_FOUND", `image tarball not found: ${baseAbs}`);
  }
  const cfgT0 = Date.now();
  const imageConfig = readImageConfig(baseAbs);
  packerOpts.onPhase?.("image-config-read", Date.now() - cfgT0);
  return { baseAbs, imageConfig };
}

function planBundleCommand(
  opts: BootOptions,
  imageConfig: BundleImageConfig | undefined,
  liveMounts: ResolvedLiveMount[],
): string[] {
  return planBootBundleCommandNative({
    explicitCmd: opts.cmd,
    imageCmd: imageConfig?.cmd,
    snapshotRestore: typeof opts.snapshot === "string",
    vmstateRestore: opts._vmstateRestorePath !== undefined,
    liveMounts,
  });
}

function writeBundleConfig(
  workspace: BundleWorkspace,
  input: {
    cmd: string[];
    env: Record<string, string>;
    guestCwd?: string;
    imageCwd?: string;
    liveMounts: ResolvedLiveMount[];
  },
): void {
  mkdirSync(join(workspace.synthBundleDir, "rootfs"), { recursive: true });
  const configJson = buildMachinenConfig(input);
  writeFileSync(join(workspace.synthBundleDir, "machinen-config.json"), JSON.stringify(configJson));
}

function resolveBundleMount(opts: BootOptions): ResolvedMountInput | undefined {
  if (!opts.mount) {
    return undefined;
  }
  validateMountGuest(opts.mount.guest);
  const hostAbs = resolve(opts.cwd ?? process.cwd(), opts.mount.host);
  if (!existsSync(hostAbs)) {
    throw new BootError(
      "BOOT_MOUNT_HOST_NOT_FOUND",
      `mount host path not found: ${opts.mount.host}`,
    );
  }
  if (!statSync(hostAbs).isDirectory()) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      `mount host path must be a directory (got a file): ${opts.mount.host}`,
    );
  }
  return { host: hostAbs, guest: normalizeMountGuest(opts.mount.guest) };
}

function packSynthesizedInitramfs(
  workspace: BundleWorkspace,
  baseAbs: string | undefined,
  mount: ResolvedMountInput | undefined,
  opts: BootOptions,
  effectiveEnv: Record<string, string>,
  packerOpts: BundlePackerOptions,
): void {
  const packT0 = Date.now();
  try {
    if (packerOpts.useTiny) {
      packTinyInitramfs(workspace, mount, opts, effectiveEnv);
    } else {
      packFatInitramfs(workspace, baseAbs, mount, effectiveEnv);
    }
    packerOpts.onPhase?.("cpio-write", Date.now() - packT0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BootError("BOOT_PACK_FAILED", `mkinitramfs pack failed: ${msg}`, { cause: err });
  }
}

function packTinyInitramfs(
  workspace: BundleWorkspace,
  mount: ResolvedMountInput | undefined,
  opts: BootOptions,
  effectiveEnv: Record<string, string>,
): void {
  mkinitramfsPackTinyBundle({
    bundle: workspace.synthBundleDir,
    out: workspace.cpioPath,
    // The cpio just carries the guest mountpoint string for /init to
    // read. The actual payload rides on virtio-blk slots 5+6.
    mountGuest: mount?.guest ?? opts._restoreMountDisk?.guest,
    env: effectiveEnv,
  });
}

function packFatInitramfs(
  workspace: BundleWorkspace,
  baseAbs: string | undefined,
  mount: ResolvedMountInput | undefined,
  effectiveEnv: Record<string, string>,
): void {
  mkinitramfsPackBundle({
    bundle: workspace.synthBundleDir,
    out: workspace.cpioPath,
    base: baseAbs,
    mount,
    env: effectiveEnv,
  });
}

function materializeBundleMountDisk(
  opts: BootOptions,
  mount: ResolvedMountInput | undefined,
  packerOpts: BundlePackerOptions,
): BundleMountDisk | undefined {
  if (!packerOpts.useTiny) {
    return undefined;
  }
  if (opts._restoreMountDisk) {
    return materializeRestoredMountDisk(opts._restoreMountDisk);
  }
  return mount ? materializeFreshMountDisk(mount, packerOpts) : undefined;
}

function materializeRestoredMountDisk(
  restoreMount: NonNullable<BootOptions["_restoreMountDisk"]>,
): BundleMountDisk {
  if (!existsSync(restoreMount.lowerPath)) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: bundle is missing mount-lower at ${restoreMount.lowerPath}`,
    );
  }
  if (!existsSync(restoreMount.upperPath)) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: bundle is missing mount-upper at ${restoreMount.upperPath}`,
    );
  }
  const perVMUpper = join(
    tmpdir(),
    `machinen-mountdisk-upper-${process.pid}-${randomBytes(6).toString("hex")}.img`,
  );
  reflinkCopy(restoreMount.upperPath, perVMUpper);
  return {
    lowerPath: restoreMount.lowerPath,
    upperPath: perVMUpper,
    guest: restoreMount.guest,
    upperSizeBytes: statSync(perVMUpper).size,
  };
}

function materializeFreshMountDisk(
  mount: ResolvedMountInput,
  packerOpts: BundlePackerOptions,
): BundleMountDisk {
  const lower = ensureMountDiskImage(mount.host, {
    onPhase: (name, ms) => packerOpts.onPhase?.(`mountdisk.${name}`, ms),
  });
  // markMountDiskImageClean is idempotent and safe to call here — we
  // only READ the cached file; the per-boot boot() flow owns lifecycle.
  const upper = ensureMountDiskUpper({
    sizeBytes: packerOpts.mountDiskUpperSizeBytes,
  });
  markMountDiskImageClean(lower.lowerPath);
  return {
    lowerPath: lower.lowerPath,
    upperPath: upper.upperPath,
    guest: mount.guest,
    upperSizeBytes: upper.sizeBytes,
  };
}
