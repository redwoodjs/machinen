// Restore a microVM from a snapshot bundle produced by `vm.snapshot()`.
// Handles bundle validation, image resolution, lazy-pagemap rewriting,
// checkpoint image delivery (eager tar on /dev/vdb vs. lazy virtio-fs mount),
// mount-overlay re-attach, and the post-boot auto-name + hostname
// patch-up.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";

import { BootError, ErrorCode } from "../errors.ts";
import { markPagemapsLazy } from "../lazy-pagemap.ts";
import { PhaseTimer } from "../phase-timer.ts";
import { planRestoreImageNative } from "../native/restore-image.ts";
import { claimName, findEntry, writeEntry } from "../registry.ts";
import { boot, type BootOptions } from "./boot.ts";
import { resolveRestoreLiveMounts } from "./bundle.ts";
import {
  isPortableSnapshotBundle,
  PortableSnapshotValidationError,
  validatePortableSnapshotBundle,
} from "./portable-snapshot.ts";
import { validateIdentity } from "./restore-identity.ts";
import { reseedVmstateGuestEntropy } from "./restore-reseed.ts";
import { resolveSnapshotEngine, VMSTATE_FILE } from "./snapshot-engine.ts";
import { materializeVmstateChain } from "./vmstate-chain.ts";
import type { SnapshotMeta, VmHandle, VmstateSnapshotMeta } from "../vm-handle.ts";
import {
  currentVmstateBackend,
  currentVmstateGuestArch,
  readVmstateFacts,
  type VmstateFacts,
} from "./vmstate-metadata.ts";
import {
  allocateSparseFile,
  buildGuestHostname,
  setGuestHostname,
  SNAP_SCRATCH_BYTES,
} from "./helpers.ts";

const debug = debugLib("machinen:boot");
const debugRestore = debugLib("machinen:restore");

export interface RestoreOptions extends Omit<BootOptions, "snapshot" | "image" | "cmd" | "name"> {
  /**
   * Snapshot bundle directory produced by `vm.snapshot()`. Vmstate bundles
   * contain `state.vmstate`, `rootdisk.img`, and `meta.json`; legacy CRIU
   * bundles contain `img/<crius>` and `meta.json`.
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
   * Opt into CRIU lazy-pages restore — the checkpoint image directory is mounted
   * into the guest read-only via in-VMM virtio-fs and `criu restore
   * --lazy-pages` faults pages on demand (#266). Default false: the runtime
   * packs the checkpoint image into a tar on `/dev/vdb`, the guest's
   * `/sbin/machinen-restore` untars it into tmpfs, and CRIU does an eager
   * load.
   *
   * Eager is still the CRIU default because lazy restore is a specialized
   * UFFD path. The historical runaway free-page-reporting blocker under
   * lazy is fixed in #290 by the in-tree kernel patch that stops the buddy
   * allocator from clearing the Reported flag during a merge.
   */
  lazy?: boolean;
}

/**
 * Restore a microVM from a snapshot bundle produced by
 * `vm.snapshot({ outDir })`. Reads the bundle's `meta.json` to
 * recover the source name, tars the checkpoint image directory into a
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
 * Live-share mounts (#273): bundles created with active `liveMounts`
 * carry only the `{guest, host, mode}` triples in `meta.liveMounts`
 * — no bytes. By default `restore()` re-establishes each recorded
 * mount as-is; the boot-time `existsSync(host)` check fails loudly
 * (BOOT_MOUNT_HOST_NOT_FOUND) if the recorded host path is gone on
 * the restoring host. Pass `liveMounts: [...]` to override per-
 * `guest` (e.g. cross-host restore with remapped paths). Each
 * override entry's `guest` MUST match a recorded one — the field is
 * an override map, not an additive list. Bundles predating this
 * field have `meta.liveMounts === undefined`; in that case
 * `opts.liveMounts` is forwarded as-is for backward compatibility.
 *
 * @throws {BootError} BOOT_SNAPSHOT_NOT_FOUND if `<snapDir>/img/`
 *   is missing or empty.
 * @throws {BootError} BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN if an entry in
 *   `opts.liveMounts` has a `guest` that doesn't appear in the
 *   bundle's `meta.liveMounts`.
 */
export async function restore(opts: RestoreOptions): Promise<VmHandle> {
  const snapDir = resolve(opts.snapDir);
  const selectedEngine = resolveSnapshotEngine();
  if (selectedEngine === "portable") {
    return restorePortable(opts, snapDir);
  }
  if (isPortableSnapshotBundle(snapDir)) {
    throw new BootError(
      "BOOT_PORTABLE_UNSUPPORTED",
      "restore: portable snapshot bundle requires MACHINEN_SNAPSHOT_ENGINE=portable.\n" +
        "  Portable restore is experimental and not yet implemented; keeping it\n" +
        "  opt-in avoids confusing semantic process restore with .vmstate/CRIU.",
    );
  }
  if (existsSync(join(snapDir, VMSTATE_FILE))) {
    return restoreVmstate(opts, snapDir);
  }
  return restoreCriu(opts, snapDir);
}

function restorePortable(opts: RestoreOptions, snapDir: string): Promise<VmHandle> {
  if (opts.lazy) {
    throw new BootError(
      "BOOT_PORTABLE_UNSUPPORTED",
      "restore: --lazy is a CRIU lazy-pages option and is not supported by the portable engine.",
    );
  }
  let program = "unknown";
  if (isPortableSnapshotBundle(snapDir)) {
    try {
      program = validatePortableSnapshotBundle(snapDir).manifest.program.name;
    } catch (err) {
      if (err instanceof PortableSnapshotValidationError) {
        throw new BootError(
          "BOOT_PORTABLE_UNSUPPORTED",
          `restore: invalid portable snapshot bundle.\n${err.message}`,
          { cause: err },
        );
      }
      throw err;
    }
  }
  throw new BootError(
    "BOOT_PORTABLE_UNSUPPORTED",
    `restore: portable snapshot engine is experimental and cannot restore workloads yet (program: ${program}).\n` +
      "  The bundle format and proof workload exist, but the checkpoint/restore\n" +
      "  implementation has not landed. Use .vmstate or CRIU for supported restores.",
  );
}

async function restoreCriu(opts: RestoreOptions, snapDir: string): Promise<VmHandle> {
  const phases = new PhaseTimer();
  const imgDir = validateCriuSnapshotBundle(snapDir);
  const meta = readSnapshotMetaWithPhase(join(snapDir, "meta.json"), phases);
  refuseMultiVcpuRestore(meta);
  const resolvedImage = resolveRestoreImage(opts, meta);
  const lazy = prepareLazyPages(opts, imgDir, phases);
  const effectiveLiveMounts = resolveRestoreLiveMounts(meta.liveMounts, opts.liveMounts);
  const delivery = prepareCriuBundleDelivery(lazy.enabled, imgDir, effectiveLiveMounts, phases);
  const vm = await bootCriuRestore({
    opts,
    snapDir,
    resolvedImage,
    delivery,
    restoreMountDisk: resolveRestoreMountDisk(snapDir, meta),
    phases,
  });
  finalizeCriuRestore(vm, opts, meta, phases, lazy.pagesTotal);
  return vm;
}

function validateCriuSnapshotBundle(snapDir: string): string {
  const imgDir = join(snapDir, "img");
  if (!existsSync(imgDir) || !statSync(imgDir).isDirectory()) {
    throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", `restore: ${imgDir} not found`);
  }
  if (!readdirSync(imgDir).some(isCoreImageName)) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: ${imgDir} has no core-*.img — is this a snapshot bundle?`,
    );
  }
  return imgDir;
}

function isCoreImageName(name: string): boolean {
  return /^core-\d+\.img$/.test(name);
}

function readSnapshotMetaWithPhase(metaPath: string, phases: PhaseTimer): SnapshotMeta {
  phases.start("snapshot-meta-read");
  const meta = readSnapshotMeta(metaPath);
  phases.end("snapshot-meta-read");
  return meta;
}

function readSnapshotMeta(metaPath: string): SnapshotMeta {
  if (!existsSync(metaPath)) {
    return { snappedAt: 0 };
  }
  try {
    return JSON.parse(readFileSync(metaPath, "utf8")) as SnapshotMeta;
  } catch {
    // Bundle predates metadata or got corrupted; fall through with an
    // anonymous source name. The fork still boots.
    return { snappedAt: 0 };
  }
}

function refuseMultiVcpuRestore(meta: SnapshotMeta): void {
  if ((meta.cpu?.maxVcpus ?? 1) <= 1) {
    return;
  }
  throw new BootError(
    "BOOT_VMSTATE_UNSUPPORTED",
    "restore: multi-vCPU snapshot bundles are not supported yet.\n" +
      "  Machinen does not yet restore every vCPU, timer, and interrupt-controller state safely.",
  );
}

function prepareLazyPages(
  opts: RestoreOptions,
  imgDir: string,
  phases: PhaseTimer,
): { enabled: boolean; pagesTotal: number | undefined } {
  if (opts.lazy !== true) {
    return { enabled: false, pagesTotal: undefined };
  }
  phases.start("snapshot-mark-lazy");
  const marked = markPagemapsLazy(imgDir);
  debug(
    "lazy-pages mark: files=%d entriesFlagged=%d alreadyLazy=%d",
    marked.filesRewritten,
    marked.entriesFlagged,
    marked.entriesAlreadyLazy,
  );
  phases.end("snapshot-mark-lazy");
  return { enabled: true, pagesTotal: marked.entriesFlagged + marked.entriesAlreadyLazy };
}

interface CriuDeliveryPlan {
  scratchPath: string;
  restoreEnv: Record<string, string>;
  liveMounts: BootOptions["liveMounts"];
}

function prepareCriuBundleDelivery(
  lazyPages: boolean,
  imgDir: string,
  effectiveLiveMounts: BootOptions["liveMounts"],
  phases: PhaseTimer,
): CriuDeliveryPlan {
  phases.start("snapshot-pack");
  try {
    return lazyPages
      ? prepareLazyCriuDelivery(imgDir, effectiveLiveMounts)
      : prepareEagerCriuDelivery(imgDir, effectiveLiveMounts);
  } finally {
    phases.end("snapshot-pack");
  }
}

function prepareLazyCriuDelivery(
  imgDir: string,
  effectiveLiveMounts: BootOptions["liveMounts"],
): CriuDeliveryPlan {
  const scratchPath = join(
    tmpdir(),
    `machinen-restore-scratch-${process.pid}-${randomBytes(6).toString("hex")}.img`,
  );
  allocateSparseFile(scratchPath, SNAP_SCRATCH_BYTES);
  return {
    scratchPath,
    restoreEnv: {
      MACHINEN_RESTORE_BUNDLE_LIVE: "1",
      MACHINEN_RESTORE_LAZY_PAGES: "1",
    },
    liveMounts: [
      ...(effectiveLiveMounts ?? []),
      { host: imgDir, guest: "/mnt/snap-src/img", mode: "ro" as const },
    ],
  };
}

function prepareEagerCriuDelivery(
  imgDir: string,
  effectiveLiveMounts: BootOptions["liveMounts"],
): CriuDeliveryPlan {
  return {
    scratchPath: packEagerRestoreBundle(imgDir),
    restoreEnv: {},
    liveMounts: effectiveLiveMounts,
  };
}

function packEagerRestoreBundle(imgDir: string): string {
  const scratchPath = join(
    tmpdir(),
    `machinen-restore-bundle-${process.pid}-${randomBytes(6).toString("hex")}.tar`,
  );
  try {
    execFileSync("tar", ["--no-xattrs", "-cf", scratchPath, "-C", imgDir, "."]);
    extendRestoreBundleTar(scratchPath);
    return scratchPath;
  } catch (err) {
    try {
      unlinkSync(scratchPath);
    } catch {}
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: failed to pack bundle from ${imgDir}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function extendRestoreBundleTar(scratchPath: string): void {
  const fd = openSync(scratchPath, "r+");
  try {
    const buf = Buffer.alloc(1);
    writeSync(fd, buf, 0, 1, SNAP_SCRATCH_BYTES - 1);
  } finally {
    closeSync(fd);
  }
}

function resolveRestoreMountDisk(
  snapDir: string,
  meta: SnapshotMeta,
): BootOptions["_restoreMountDisk"] {
  if (!meta.mountDisk) {
    return undefined;
  }
  const lowerAbs = join(snapDir, meta.mountDisk.lower);
  const upperAbs = join(snapDir, meta.mountDisk.upper);
  if (!existsSync(lowerAbs) || !existsSync(upperAbs)) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: bundle's mount overlay is missing one of:\n  ${lowerAbs}\n  ${upperAbs}`,
    );
  }
  return {
    guest: meta.mountDisk.guest,
    lowerPath: lowerAbs,
    upperPath: upperAbs,
  };
}

async function bootCriuRestore(args: {
  opts: RestoreOptions;
  snapDir: string;
  resolvedImage: string;
  delivery: CriuDeliveryPlan;
  restoreMountDisk: BootOptions["_restoreMountDisk"];
  phases: PhaseTimer;
}): Promise<VmHandle> {
  args.phases.start("boot");
  try {
    const vm = await boot({
      ...args.opts,
      image: args.resolvedImage,
      snapshot: args.delivery.scratchPath,
      forkedFrom: args.snapDir,
      name: args.opts.name,
      liveMounts: args.delivery.liveMounts,
      env: { ...args.opts.env, ...args.delivery.restoreEnv },
      _restoreMountDisk: args.restoreMountDisk,
    });
    args.phases.end("boot");
    return vm;
  } finally {
    try {
      unlinkSync(args.delivery.scratchPath);
    } catch {}
  }
}

function finalizeCriuRestore(
  vm: VmHandle,
  opts: RestoreOptions,
  meta: SnapshotMeta,
  phases: PhaseTimer,
  lazyPagesTotal: number | undefined,
): void {
  autoNameRestoredFork(vm, opts, meta);
  persistLazyPagesTotal(vm, lazyPagesTotal);
  probeRestoredGuestHostname(vm, phases);
}

function persistLazyPagesTotal(vm: VmHandle, lazyPagesTotal: number | undefined): void {
  if (lazyPagesTotal === undefined) {
    return;
  }
  const cur = findEntry({ pid: vm.pid });
  if (cur) {
    writeEntry({
      ...cur,
      lazyPagesTotal,
    });
  }
}

function probeRestoredGuestHostname(vm: VmHandle, phases: PhaseTimer): void {
  phases.start("criu-restore-probe");
  let hostname: string;
  try {
    hostname = buildGuestHostname(vm.pid, vm.name);
  } catch (err) {
    debugRestore(
      "setGuestHostname: planner failed pid=%d name=%s err=%s",
      vm.pid,
      vm.name ?? "",
      err instanceof Error ? err.message : String(err),
    );
    phases.end("criu-restore-probe");
    phases.flush(debugRestore, "restore");
    return;
  }
  void setGuestHostname(vm, hostname).finally(() => {
    phases.end("criu-restore-probe");
    phases.flush(debugRestore, "restore");
  });
}

// Resolve the rootfs image for a restore: caller's `opts.image` wins,
// else the path the source booted from (recorded in meta.json). Both
// engines need a base rootfs — criu reopens file-backed VMAs against
// it; the vmstate engine materializes the restored guest's /dev/vda
// from it. Shared by the criu and vmstate restore paths.
function resolveRestoreImage(opts: RestoreOptions, meta: SnapshotMeta): string {
  const explicitPath = opts.image ? resolve(opts.cwd ?? process.cwd(), opts.image) : undefined;
  const plan = planRestoreImageNative({
    explicitPath,
    explicitExists: explicitPath ? existsSync(explicitPath) : undefined,
    metaSourcePath: meta.sourceImage,
    metaSourceExists: meta.sourceImage ? existsSync(meta.sourceImage) : undefined,
  });
  if (plan.path) {
    if (!explicitPath) {
      debugRestore("using meta.sourceImage path=%s", plan.path);
    }
    return plan.path;
  }
  if (plan.error === "explicit-missing") {
    throw new BootError("BOOT_IMAGE_NOT_FOUND", `restore: image not found: ${explicitPath}`);
  }
  if (plan.error === "meta-missing") {
    throw missingRestoreMetaImageError(meta.sourceImage!);
  }
  throw missingRestoreImageError();
}

function missingRestoreMetaImageError(sourceImage: string): BootError {
  // The bundle remembers a path, but it's gone on this host (e.g.
  // restored on a different machine, or the tarball was deleted).
  return new BootError(
    "BOOT_IMAGE_NOT_FOUND",
    `restore: source image not found at ${sourceImage}\n` +
      `  The snapshot was taken with this rootfs tarball, and the restore\n` +
      `  needs it as the guest's base rootfs.\n` +
      `  • copy the tarball to that path on this host, OR\n` +
      `  • pass an explicit override via the runtime's restore({ image })\n` +
      `    or the CLI's \`machinen restore --image <tarball>\`.`,
  );
}

function missingRestoreImageError(): BootError {
  return new BootError(
    "BOOT_IMAGE_NOT_FOUND",
    `restore: no rootfs image available for this bundle.\n` +
      `  The snapshot's meta.json doesn't record a source image (likely\n` +
      `  predates the field). Pass the same tarball you booted the\n` +
      `  source VM with via the runtime's restore({ image }) or the\n` +
      `  CLI's \`machinen restore --image <tarball>\`.`,
  );
}

// Default auto-name for a restored VM nests under the source:
// `<src>/<pid>`. claimName refuses (returns false) when `<src>` is
// still a live pin file — the fork case (#216), where the source VM
// is running — so we fall back to a flat sibling `<src>~<pid>`.
// Shared by the criu and vmstate restore paths.
function autoNameRestoredFork(vm: VmHandle, opts: RestoreOptions, meta: SnapshotMeta): void {
  if (opts.name || !meta.sourceName) {
    return;
  }
  const candidates = [`${meta.sourceName}/${vm.pid}`, `${meta.sourceName}~${vm.pid}`];
  for (const candidate of candidates) {
    if (claimName(candidate, vm.pid)) {
      const cur = findEntry({ pid: vm.pid });
      if (cur) {
        writeEntry({ ...cur, name: candidate });
      }
      (vm as { name?: string }).name = candidate;
      break;
    }
  }
}

interface VmstateRestorePlan {
  memoryCeiling?: number;
  rootDisk?: BootOptions["rootDisk"];
  rootDiskRestorePath?: string;
}

function planVmstateRestore(
  opts: RestoreOptions,
  meta: SnapshotMeta,
  snapDir: string,
  statePath: string,
  phases?: PhaseTimer,
): VmstateRestorePlan {
  phases?.start("plan.read-vmstate-facts");
  const facts = readVmstateFactsOrBootError(statePath);
  phases?.end("plan.read-vmstate-facts");
  const vmstate = meta.vmstate;
  if (!vmstate) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: vmstate bundle predates restore invariants.\n" +
        "  Refusing to boot because old bundles do not record the source VMM,\n" +
        "  guest PAuth policy, memory topology, or exact rootdisk bytes.\n" +
        "  Recreate the snapshot with a current machinen build.",
    );
  }
  phases?.start("plan.validate-invariants");
  validateVmstateTopology(vmstate, facts);
  validateVmstateGuestArch(vmstate, facts);
  validateVmstateBackendAndPauth(vmstate, facts);
  phases?.end("plan.validate-invariants");
  phases?.start("plan.validate-artifacts");
  validateVmstateArtifacts(opts, vmstate);
  phases?.end("plan.validate-artifacts");
  phases?.start("plan.resolve-memory");
  const memoryCeiling = resolveVmstateMemoryCeiling(opts, vmstate);
  phases?.end("plan.resolve-memory");
  phases?.start("plan.resolve-rootdisk");
  const rootDisk = resolveVmstateRootDisk(opts, vmstate, snapDir, phases);
  phases?.end("plan.resolve-rootdisk");
  return {
    memoryCeiling,
    ...rootDisk,
  };
}

function readVmstateFactsOrBootError(statePath: string): VmstateFacts {
  try {
    return readVmstateFacts(statePath);
  } catch (err) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: failed to read vmstate header from ${statePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
}

function validateVmstateTopology(vmstate: VmstateSnapshotMeta, facts: VmstateFacts): void {
  if (vmstate.topologyHash && vmstate.topologyHash !== facts.topologyHash) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      `restore: vmstate topology metadata does not match state.vmstate.\n` +
        `  meta:  ${vmstate.topologyHash}\n` +
        `  state: ${facts.topologyHash}`,
    );
  }
}

function crossIsaVmstateRestoreRefusal(_sourceArch: string, _targetArch: string): { code: string } {
  return { code: "cross-isa-vmstate-restore-unsupported" };
}

function validateVmstateGuestArch(vmstate: VmstateSnapshotMeta, facts: VmstateFacts): void {
  const source = vmstate.guestArch ?? facts.arch ?? "unknown";
  const target = currentVmstateGuestArch();
  if (vmstate.guestArch && facts.arch !== "unknown" && vmstate.guestArch !== facts.arch) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      `restore: vmstate guest architecture metadata does not match state.vmstate.\n` +
        `  meta:  ${vmstate.guestArch}\n` +
        `  state: ${facts.arch}`,
    );
  }
  if (source !== "unknown" && target !== "unknown" && source !== target) {
    const refusal = crossIsaVmstateRestoreRefusal(source, target);
    throw new BootError(
      ErrorCode.BOOT_VMSTATE_CROSS_ISA_UNSUPPORTED,
      `restore: raw cross-ISA vmstate restore is unsupported.\n` +
        `  snapshot guest: ${source}\n` +
        `  restore guest:  ${target}\n` +
        `  refusal: ${refusal.code}\n` +
        "  Whole-VM .vmstate replays source kernel/vCPU/device state and is same-architecture only.\n" +
        "  Cross-ISA VM/process movement is not exposed as a public command.",
    );
  }
}

function validateVmstateBackendAndPauth(vmstate: VmstateSnapshotMeta, facts: VmstateFacts): void {
  const source = vmstate.sourceBackend ?? "unknown";
  const target = currentVmstateBackend();
  if (!isCrossVmmRestore(source, target)) {
    return;
  }

  const pauthActive = vmstatePauthActive(vmstate, facts);
  if (pauthActive === false) {
    return;
  }
  throw unsupportedCrossVmmPauthError(source, target, pauthActive, vmstate, facts);
}

function isCrossVmmRestore(source: string, target: string): boolean {
  if (source === "unknown") {
    return false;
  }
  if (target === "unknown") {
    return false;
  }
  return source !== target;
}

function vmstatePauthActive(
  vmstate: VmstateSnapshotMeta,
  facts: VmstateFacts,
): boolean | undefined {
  if (facts.guestPauthActive !== undefined) {
    return facts.guestPauthActive;
  }
  return vmstate.guestPauth?.active;
}

function unsupportedCrossVmmPauthError(
  source: string,
  target: string,
  pauthActive: boolean | undefined,
  vmstate: VmstateSnapshotMeta,
  facts: VmstateFacts,
): BootError {
  return new BootError(
    "BOOT_VMSTATE_UNSUPPORTED",
    `restore: unsupported cross-VMM vmstate restore (${source} → ${target}).\n` +
      `  The snapshot has guest pointer authentication ${pauthStateLabel(
        pauthActive,
      )} (SCTLR_EL1=${pauthSctlrLabel(vmstate, facts)}).\n` +
      "  Recreate the source guest with PAuth disabled (the default machinen\n" +
      "  DTB includes `arm64.nopauth`) before moving vmstate across HVF/KVM.",
  );
}

function pauthStateLabel(pauthActive: boolean | undefined): string {
  if (pauthActive === true) {
    return "enabled";
  }
  return "in an unknown state";
}

function pauthSctlrLabel(vmstate: VmstateSnapshotMeta, facts: VmstateFacts): string {
  if (facts.sctlrEl1 !== undefined) {
    return facts.sctlrEl1;
  }
  if (vmstate.guestPauth?.sctlrEl1 !== undefined) {
    return vmstate.guestPauth.sctlrEl1;
  }
  return "unknown";
}

function validateVmstateArtifacts(opts: RestoreOptions, vmstate: VmstateSnapshotMeta): void {
  if (opts.kernel && vmstate.kernel) {
    validateIdentity(
      "kernel",
      resolve(opts.cwd ?? process.cwd(), opts.kernel),
      vmstate.kernel,
      undefined,
      "external",
    );
  }
  if (opts.dtb && vmstate.dtb) {
    validateIdentity(
      "dtb",
      resolve(opts.cwd ?? process.cwd(), opts.dtb),
      vmstate.dtb,
      undefined,
      "external",
    );
  }
}

function resolveVmstateMemoryCeiling(
  opts: RestoreOptions,
  vmstate: VmstateSnapshotMeta,
): number | undefined {
  const expected = vmstate.memoryCeilingMib;
  if (expected === undefined) {
    return undefined;
  }
  const envMib = restoreEnvMemoryMib(opts);
  const requested = requestedRestoreMemory(opts, envMib);
  validateVmstateMemoryCeiling(expected, requested);
  if (shouldApplySnapshotMemoryCeiling(opts, envMib)) {
    return expected;
  }
  return undefined;
}

function restoreEnvMemoryMib(opts: RestoreOptions): number | undefined {
  const envMemory = restoreEnvMemory(opts);
  if (envMemory === undefined) {
    return undefined;
  }
  return Number(envMemory);
}

function restoreEnvMemory(opts: RestoreOptions): string | undefined {
  const fromOpts = opts.vmmEnv?.MACHINEN_MEMORY;
  if (fromOpts !== undefined) {
    return fromOpts;
  }
  return process.env.MACHINEN_MEMORY;
}

function requestedRestoreMemory(
  opts: RestoreOptions,
  envMib: number | undefined,
): number | undefined {
  if (opts.memory !== undefined) {
    return opts.memory;
  }
  return envMib;
}

function validateVmstateMemoryCeiling(expected: number, requested: number | undefined): void {
  if (requested === undefined) {
    return;
  }
  if (requested === expected) {
    return;
  }
  throw new BootError(
    "BOOT_VMSTATE_UNSUPPORTED",
    `restore: vmstate guest RAM layout mismatch.\n` +
      `  snapshot ceiling: ${expected} MiB\n` +
      `  restore ceiling:  ${requested} MiB\n` +
      "  This is the VM's address layout, not current host memory use.\n" +
      "  Whole-VM restore requires the same RAM topology.",
  );
}

function shouldApplySnapshotMemoryCeiling(
  opts: RestoreOptions,
  envMib: number | undefined,
): boolean {
  if (opts.memory !== undefined) {
    return false;
  }
  if (envMib !== undefined) {
    return false;
  }
  return true;
}

function resolveVmstateRootDisk(
  opts: RestoreOptions,
  vmstate: VmstateSnapshotMeta,
  snapDir: string,
  phases?: PhaseTimer,
): Pick<VmstateRestorePlan, "rootDisk" | "rootDiskRestorePath"> {
  const recorded = vmstate.rootDisk;
  if (!recorded) {
    return resolveMissingVmstateRootDisk(opts);
  }
  if (recorded.mode === "delta") {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: vmstate rootdisk delta was not materialized. This is a checkpoint-chain bug.",
    );
  }
  if (recorded.mode === "none") {
    return resolveNoneVmstateRootDisk(opts);
  }
  return resolveFileVmstateRootDisk(opts, snapDir, recorded, phases);
}

function resolveMissingVmstateRootDisk(
  opts: RestoreOptions,
): Pick<VmstateRestorePlan, "rootDisk" | "rootDiskRestorePath"> {
  if (opts.rootDisk !== undefined) {
    return { rootDisk: opts.rootDisk };
  }
  throw new BootError(
    "BOOT_VMSTATE_UNSUPPORTED",
    "restore: vmstate bundle has no rootdisk invariant.\n" +
      "  A whole-VM snapshot resumes with file-backed VMAs and block-device\n" +
      "  queues that depend on the exact /dev/vda bytes. Recreate the\n" +
      "  snapshot so the bundle includes rootdisk.img, or pass an explicit\n" +
      "  restore({ rootDisk: <exact-image> }) to opt into caller-managed bytes.",
  );
}

function resolveNoneVmstateRootDisk(
  opts: RestoreOptions,
): Pick<VmstateRestorePlan, "rootDisk" | "rootDiskRestorePath"> {
  if (typeof opts.rootDisk === "string") {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: snapshot was taken without a root block device, but restore passed rootDisk.",
    );
  }
  return { rootDisk: false };
}

type VmstateRootDiskBlock = Extract<
  NonNullable<VmstateSnapshotMeta["rootDisk"]>,
  { mode: "block" }
>;

function resolveFileVmstateRootDisk(
  opts: RestoreOptions,
  snapDir: string,
  recorded: VmstateRootDiskBlock,
  phases?: PhaseTimer,
): Pick<VmstateRestorePlan, "rootDisk" | "rootDiskRestorePath"> {
  if (opts.rootDisk === false) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: snapshot requires an exact root block device, but restore passed rootDisk:false.",
    );
  }
  if (typeof opts.rootDisk === "string") {
    const explicit = resolve(opts.cwd ?? process.cwd(), opts.rootDisk);
    validateIdentity("rootdisk", explicit, recorded, phases, "external");
    return { rootDisk: explicit };
  }

  const bundled = join(snapDir, recorded.file);
  if (!existsSync(bundled)) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: vmstate bundle is missing rootdisk image: ${bundled}`,
    );
  }
  validateIdentity("rootdisk", bundled, recorded, phases, "bundled");
  return { rootDiskRestorePath: bundled };
}

/**
 * Restore a vmstate (whole-VM) bundle: `<snapDir>/state.vmstate` plus
 * `meta.json`. Unlike the CRIU path there's no scratch tar and no
 * guest-side restore agent — `boot()` hands the state file to the VMM
 * via `_vmstateRestorePath` (→ `MACHINEN_RESTORE_PATH`), and the VMM
 * loads vCPU + RAM + GIC + virtio device state before the first vCPU
 * run, so the guest resumes mid-execution.
 *
 * The rootfs tarball is still used to build the tiny initramfs around
 * the restored guest, but `/dev/vda` comes from the bundle's exact
 * `rootdisk.img` (or from an explicit caller-managed `rootDisk`). A
 * vmstate captures RAM/device/vCPU state, not block-device bytes, so
 * rematerializing a tarball into a fresh ext4 image is not safe.
 */
async function restoreVmstate(opts: RestoreOptions, snapDir: string): Promise<VmHandle> {
  const phases = new PhaseTimer();
  let prepared: PreparedVmstateRestoreBundle | undefined;
  let vm: VmHandle;
  try {
    phases.start("read-meta");
    prepared = initialVmstateRestoreBundle(snapDir);
    phases.end("read-meta");
    phases.start("materialize-chain");
    prepared = materializeVmstateRestoreChainIfNeeded(snapDir, prepared);
    phases.end("materialize-chain");
    phases.start("resolve-image");
    const resolvedImage = resolveRestoreImage(opts, prepared.meta);
    phases.end("resolve-image");
    phases.start("plan");
    const vmstatePlan = planVmstateRestore(
      opts,
      prepared.meta,
      prepared.effectiveSnapDir,
      prepared.statePath,
      phases,
    );
    phases.end("plan");
    phases.start("boot");
    vm = await bootVmstateRestore(opts, snapDir, prepared, resolvedImage, vmstatePlan);
    phases.end("boot");
    phases.start("entropy-reseed");
    const reseedMode = await reseedVmstateGuestEntropy(vm);
    const reseedMs = phases.end("entropy-reseed");
    phases.mark(`entropy-reseed.${reseedMode}`, reseedMs);
  } finally {
    phases.start("cleanup-materialized-chain");
    cleanupMaterializedVmstate(prepared?.materializedTempDir);
    phases.end("cleanup-materialized-chain");
  }

  phases.start("auto-name");
  autoNameRestoredFork(vm, opts, prepared.meta);
  phases.end("auto-name");
  phases.start("hostname-restamp-dispatch");
  restampRestoredHostname(vm);
  phases.end("hostname-restamp-dispatch");
  phases.flush(debugRestore, "restore");
  return vm;
}

interface PreparedVmstateRestoreBundle {
  statePath: string;
  effectiveSnapDir: string;
  materializedTempDir: string | undefined;
  meta: SnapshotMeta;
}

function initialVmstateRestoreBundle(snapDir: string): PreparedVmstateRestoreBundle {
  const meta = readSnapshotMeta(join(snapDir, "meta.json"));
  refuseMultiVcpuRestore(meta);
  return {
    statePath: join(snapDir, VMSTATE_FILE),
    effectiveSnapDir: snapDir,
    materializedTempDir: undefined,
    meta,
  };
}

function materializeVmstateRestoreChainIfNeeded(
  snapDir: string,
  prepared: PreparedVmstateRestoreBundle,
): PreparedVmstateRestoreBundle {
  if (!prepared.meta.vmstate?.checkpoint?.parent) {
    return prepared;
  }
  const materialized = materializeVmstateChain(snapDir, prepared.meta);
  return {
    statePath: materialized.statePath,
    effectiveSnapDir: materialized.snapDir,
    materializedTempDir: materialized.tempDir,
    meta: materialized.meta,
  };
}

async function bootVmstateRestore(
  opts: RestoreOptions,
  snapDir: string,
  prepared: PreparedVmstateRestoreBundle,
  resolvedImage: string,
  vmstatePlan: VmstateRestorePlan,
): Promise<VmHandle> {
  debugRestore(
    "vmstate restore snapDir=%s state=%s image=%s",
    snapDir,
    prepared.statePath,
    resolvedImage,
  );
  return boot({
    ...opts,
    image: resolvedImage,
    forkedFrom: snapDir,
    name: opts.name,
    liveMounts: resolveRestoreLiveMounts(prepared.meta.liveMounts, opts.liveMounts),
    memory: vmstatePlan.memoryCeiling ?? opts.memory,
    rootDisk: vmstatePlan.rootDisk ?? opts.rootDisk,
    _restoreMountDisk: resolveRestoreMountDisk(snapDir, prepared.meta),
    _vmstateRestorePath: prepared.statePath,
    _rootDiskRestorePath: vmstatePlan.rootDiskRestorePath,
  });
}

function cleanupMaterializedVmstate(materializedTempDir: string | undefined): void {
  if (materializedTempDir) {
    try {
      rmSync(materializedTempDir, { recursive: true, force: true });
    } catch {}
  }
}

function restampRestoredHostname(vm: VmHandle): void {
  try {
    void setGuestHostname(vm, buildGuestHostname(vm.pid, vm.name)).catch(() => {});
  } catch (err) {
    debugRestore(
      "setGuestHostname: planner failed pid=%d name=%s err=%s",
      vm.pid,
      vm.name ?? "",
      err instanceof Error ? err.message : String(err),
    );
  }
}
