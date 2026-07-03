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
import { planBootLiveMountsNative, planBootMountDiskRuntimeNative } from "../native/boot-plan.ts";
import { planBootBundleMountDiskModeNative } from "../native/bundle-mount-disk-mode.ts";
import { planBootMountDiskTempPathNative } from "../native/mount-disk-temp-path.ts";
import { validateLiveMountRemovedOptionsNative } from "../native/live-mount-options.ts";
import type { BundlePackPlan } from "../native/boot-plan-schema.ts";
import { planRestoreLiveMountsNative } from "../native/restore-live-mounts.ts";
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
    unsafeGuestPath?: boolean;
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
  validateLiveMountRemovedOptionsNative(mount, index);
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
  const config: Record<string, unknown> = {
    cmd: input.cmd,
    env: input.env,
  };
  const cwd = input.guestCwd ?? input.imageCwd;
  if (cwd !== undefined) {
    config.cwd = cwd;
  }
  config.liveMounts = input.liveMounts.map(({ guest, tag, mode }) => ({ guest, tag, mode }));
  return config;
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
  const overrideList = overrides ?? [];
  overrideList.forEach((ov, i) => rejectRemovedLiveMountOptions(ov, i));
  const planned = planRestoreLiveMountsNative(recorded, overrideList);
  return planned.length > 0 ? planned : undefined;
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
    const effectiveEnv = mergeBundleEnv(image.imageConfig?.env, mergedGuestEnv);
    writeBundleConfig(workspace, {
      cmd,
      env: effectiveEnv,
      guestCwd: opts.guestCwd,
      imageCwd: image.imageConfig?.cwd,
      liveMounts,
    });
    const mount = resolveBundleMount(opts);
    const packPlan = planBundlePack({
      useTiny: packerOpts.useTiny,
      mountGuest: mount?.guest,
      restoreMountGuest: opts._restoreMountDisk?.guest,
    });
    packSynthesizedInitramfs(workspace, image.baseAbs, mount, packPlan, packerOpts);
    return {
      tempDir: workspace.tempDir,
      cpioPath: workspace.cpioPath,
      mountDisk: materializeBundleMountDisk(opts, mount, packerOpts, packPlan),
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
  const cmd = opts.cmd ?? fallbackBundleCommand(opts, imageConfig);
  if (!cmd) {
    throw new BootError(
      "BOOT_CMD_MISSING",
      "boot: no cmd to run — pass `cmd` on boot() or bake one into the image via `provision({ cmd })`.",
    );
  }
  if (isSupervisorCommand(cmd)) {
    return cmd;
  }
  const workload = hasWritableLiveMount(liveMounts) ? wrapBatchWorkloadCommand(cmd) : cmd;
  return [
    "/sbin/machinen-supervisor",
    ...(typeof opts.snapshot === "string" ? ["--session"] : []),
    ...workload,
  ];
}

function fallbackBundleCommand(
  opts: BootOptions,
  imageConfig: BundleImageConfig | undefined,
): string[] | undefined {
  if (typeof opts.snapshot === "string") {
    return ["/sbin/machinen-restore"];
  }
  if (opts._vmstateRestorePath !== undefined) {
    return ["/sbin/machinen-poweroff"];
  }
  return imageConfig?.cmd;
}

function isSupervisorCommand(cmd: string[]): boolean {
  return cmd[0] === "/exec-agent" || cmd[0] === "/sbin/machinen-restore";
}

function hasWritableLiveMount(liveMounts: ResolvedLiveMount[]): boolean {
  return liveMounts.some((mount) => mount.mode === "rw");
}

function wrapBatchWorkloadCommand(cmd: string[]): string[] {
  const batchScript =
    "batch_sync() { " +
    "if [ -s /run/machinen-batch-sync.sh ]; then " +
    "sh /run/machinen-batch-sync.sh; fi; }; " +
    '"$@" & child=$!; ' +
    "trap 'kill -TERM \"$child\" 2>/dev/null' TERM; " +
    "trap 'kill -INT \"$child\" 2>/dev/null' INT; " +
    'wait "$child"; status=$?; ' +
    "batch_sync || { sync_status=$?; " +
    'if [ "$status" -eq 0 ]; then status=$sync_status; fi; }; ' +
    'exit "$status"';
  return ["/bin/sh", "-c", batchScript, "machinen-batch-wrapper", ...cmd];
}

function mergeBundleEnv(
  imageEnv: Record<string, string> | undefined,
  guestEnv: Record<string, string>,
): Record<string, string> {
  return { ...imageEnv, ...guestEnv };
}

function planBundlePack(input: {
  useTiny: boolean;
  mountGuest?: string;
  restoreMountGuest?: string;
}): BundlePackPlan {
  if (!input.useTiny) {
    return { kind: "fat", tinyMountGuest: null };
  }
  return { kind: "tiny", tinyMountGuest: input.mountGuest ?? input.restoreMountGuest ?? null };
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
  const rootfsDir = join(workspace.synthBundleDir, "rootfs");
  mkdirSync(rootfsDir, { recursive: true });
  const configJson = buildMachinenConfig(input);
  writeFileSync(join(workspace.synthBundleDir, "machinen-config.json"), JSON.stringify(configJson));
}

function resolveBundleMount(opts: BootOptions): ResolvedMountInput | undefined {
  if (!opts.mount) {
    return undefined;
  }
  validateMountGuest(opts.mount.guest, opts.mount.unsafeGuestPath === true);
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
  return {
    host: hostAbs,
    guest: normalizeMountGuest(opts.mount.guest, opts.mount.unsafeGuestPath === true),
  };
}

function packSynthesizedInitramfs(
  workspace: BundleWorkspace,
  baseAbs: string | undefined,
  mount: ResolvedMountInput | undefined,
  packPlan: BundlePackPlan,
  packerOpts: BundlePackerOptions,
): void {
  const packT0 = Date.now();
  try {
    if (packPlan.kind === "tiny") {
      packTinyInitramfs(workspace, packPlan.tinyMountGuest);
    } else {
      packFatInitramfs(workspace, baseAbs, mount);
    }
    packerOpts.onPhase?.("cpio-write", Date.now() - packT0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BootError("BOOT_PACK_FAILED", `mkinitramfs pack failed: ${msg}`, { cause: err });
  }
}

function packTinyInitramfs(workspace: BundleWorkspace, mountGuest: string | null): void {
  mkinitramfsPackTinyBundle({
    bundle: workspace.synthBundleDir,
    out: workspace.cpioPath,
    // The cpio just carries the guest mountpoint string for /init to
    // read. The actual payload rides on virtio-blk slots 5+6.
    mountGuest: mountGuest ?? undefined,
  });
}

function packFatInitramfs(
  workspace: BundleWorkspace,
  baseAbs: string | undefined,
  mount: ResolvedMountInput | undefined,
): void {
  mkinitramfsPackBundle({
    bundle: workspace.synthBundleDir,
    out: workspace.cpioPath,
    base: baseAbs,
    mount,
  });
}

function materializeBundleMountDisk(
  opts: BootOptions,
  mount: ResolvedMountInput | undefined,
  packerOpts: BundlePackerOptions,
  packPlan: BundlePackPlan,
): BundleMountDisk | undefined {
  const mode = planBootBundleMountDiskModeNative({
    useTiny: packPlan.kind === "tiny",
    mountGuest: mount?.guest,
    restoreMountGuest: opts._restoreMountDisk?.guest,
  });
  if (mode.action === "restore" && opts._restoreMountDisk) {
    return materializeRestoredMountDisk(opts._restoreMountDisk);
  }
  if (mode.action === "fresh" && mount) {
    return materializeFreshMountDisk(mount, packerOpts);
  }
  return undefined;
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
  const perVMUpper = mountDiskRestoreUpperPath();
  reflinkCopy(restoreMount.upperPath, perVMUpper);
  return requireMountDiskPlan(
    planBootMountDiskRuntimeNative({
      mode: "restore",
      lowerPath: restoreMount.lowerPath,
      upperPath: perVMUpper,
      sourceUpperPath: restoreMount.upperPath,
      guest: restoreMount.guest,
      upperSizeBytes: statSync(perVMUpper).size,
    }),
  );
}

function mountDiskRestoreUpperPath(): string {
  return planBootMountDiskTempPathNative({
    kind: "restore-upper",
    tmpDir: tmpdir(),
    pid: process.pid,
    nonce: randomBytes(6).toString("hex"),
  });
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
  return requireMountDiskPlan(
    planBootMountDiskRuntimeNative({
      mode: "fresh",
      lowerPath: lower.lowerPath,
      upperPath: upper.upperPath,
      guest: mount.guest,
      upperSizeBytes: upper.sizeBytes,
    }),
  );
}

function requireMountDiskPlan(
  plan: ReturnType<typeof planBootMountDiskRuntimeNative>,
): BundleMountDisk {
  if (
    plan.lowerPath === null ||
    plan.upperPath === null ||
    plan.guest === null ||
    plan.upperSizeBytes === null
  ) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      "boot: native planner returned incomplete mount disk plan",
    );
  }
  return {
    lowerPath: plan.lowerPath,
    upperPath: plan.upperPath,
    guest: plan.guest,
    upperSizeBytes: plan.upperSizeBytes,
  };
}
