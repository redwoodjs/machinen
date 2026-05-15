// Restore a microVM from a snapshot bundle produced by `vm.snapshot()`.
// Handles bundle validation, image resolution, lazy-pagemap rewriting,
// CRIU image delivery (eager tar on /dev/vdb vs. lazy FUSE mount),
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
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";

import { BootError } from "../errors.ts";
import { markPagemapsLazy } from "../lazy-pagemap.ts";
import { PhaseTimer } from "../phase-timer.ts";
import { claimName, findEntry, writeEntry } from "../registry.ts";
import { boot, type BootOptions } from "./boot.ts";
import { resolveRestoreLiveMounts } from "./bundle.ts";
import { VMSTATE_FILE } from "./snapshot-engine.ts";
import type { SnapshotMeta, VmHandle } from "../vm-handle.ts";
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
   * Opt into lazy-pages restore — bundle is vsock-FUSE-mounted into
   * the guest read-only and `criu restore --lazy-pages` faults pages
   * on demand (#266). Default false: the runtime packs the CRIU
   * image into a tar on `/dev/vdb`, the guest's
   * `/sbin/machinen-restore` untars it into tmpfs, and CRIU does an
   * eager load.
   *
   * Eager is still the default because lazy bundles a host-side FUSE
   * server that doesn't compose with `--detach` (#150 phase 3). The
   * historical second blocker — runaway free-page-reporting under
   * lazy — is fixed in #290 by the in-tree kernel patch that stops
   * the buddy allocator from clearing the Reported flag during a
   * merge.
   */
  lazy?: boolean;
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
  // #221: per-phase timeline for restore. Boot's own phases get logged
  // separately under DEBUG=machinen:boot — restore tracks the parts
  // that are restore-specific (meta-read, the boot rollup, and the
  // wall-clock until the restored guest is responsive over vsock).
  const phases = new PhaseTimer();
  const snapDir = resolve(opts.snapDir);

  // Auto-detect the engine from the bundle's contents: a
  // `state.vmstate` file means the vmstate (whole-VM) engine produced
  // it. A bundle always restores under the engine that wrote it,
  // regardless of the MACHINEN_SNAPSHOT_ENGINE env var.
  if (existsSync(join(snapDir, VMSTATE_FILE))) {
    return restoreVmstate(opts, snapDir);
  }

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
  const resolvedImage = resolveRestoreImage(opts, meta);

  // Lazy-pages mode (#266, opt-in via `lazy: true`): mark every
  // PE_PRESENT pagemap entry that lives in an anon-private VMA with
  // PE_LAZY in place on the host before boot, so
  // `criu restore --lazy-pages` actually registers UFFD on those
  // entries instead of loading them eagerly. Dumps are taken without
  // `--lazy-pages` (machinen-dump.sh keeps the dump path simple);
  // without this rewrite the lazy-pages daemon would see no lazy
  // entries and load the whole image up front. Idempotent. See
  // packages/runtime/src/lazy-pagemap.ts.
  const lazyPages = opts.lazy === true;
  let lazyPagesTotal: number | undefined;
  if (lazyPages) {
    phases.start("snapshot-mark-lazy");
    const marked = markPagemapsLazy(imgDir);
    lazyPagesTotal = marked.entriesFlagged + marked.entriesAlreadyLazy;
    debug(
      "lazy-pages mark: files=%d entriesFlagged=%d alreadyLazy=%d",
      marked.filesRewritten,
      marked.entriesFlagged,
      marked.entriesAlreadyLazy,
    );
    phases.end("snapshot-mark-lazy");
  }

  // #273: live-share FUSE mounts the source had at snapshot time.
  // Re-establish them on the restored VM so the workload's view of
  // /mnt/<guest>/ comes back intact. opts.liveMounts is an override
  // map keyed by `guest` (see resolveRestoreLiveMounts).
  const effectiveLiveMounts = resolveRestoreLiveMounts(meta.liveMounts, opts.liveMounts);

  // Bundle delivery split by mode:
  //   - eager (default): pack `imgDir/` into a tar archive attached
  //     as /dev/vdb. The guest's machinen-restore.sh untars into
  //     tmpfs and CRIU does an eager load. Simple, robust — and on the
  //     workloads we actually ship for (small JS heaps, short-lived
  //     MicroVMs) the workload faults every page within the first
  //     second anyway, so the lazy save is moot.
  //   - lazy (opt-in via `lazy: true`): live-mount `imgDir/` read-only
  //     at /mnt/snap-src/img via an in-VMM virtio-fs device (#332). CRIU
  //     restore reads pagemap-*.img + pages-*.img directly through it;
  //     bytes stream from the host on demand and never materialize in
  //     guest tmpfs. This is the #266 path — it keeps host RSS
  //     proportional to the touched set. The historical virtio-balloon
  //     interaction is fixed in #290 (in-tree kernel patch).
  phases.start("snapshot-pack");
  const restoreEnv: Record<string, string> = {};
  let scratchPath: string;
  let liveMounts: Array<{ host: string; guest: string; mode?: "ro" | "rw" }> | undefined;
  if (lazyPages) {
    scratchPath = join(
      tmpdir(),
      `machinen-restore-scratch-${process.pid}-${randomBytes(6).toString("hex")}.img`,
    );
    allocateSparseFile(scratchPath, SNAP_SCRATCH_BYTES);
    restoreEnv.MACHINEN_RESTORE_BUNDLE_LIVE = "1";
    restoreEnv.MACHINEN_RESTORE_LAZY_PAGES = "1";
    // #290: lazy-restore + virtio-balloon free-page-reporting used to
    // get into a runaway re-report cycle — the workload's PE_LAZY anon
    // range stays as huge contiguous free runs in the buddy allocator,
    // and `__free_one_page`'s buddy merge clears the Reported flag on
    // every neighbour it merges with, so the next reporting cycle sees
    // the merged block as unreported and reports the same physical
    // region again. Fixed in the guest kernel by
    // `packages/microvm/patches/kernel/0001-mm-page-reporting-skip-merge-with-reported-buddy.patch`,
    // which refuses to merge a freshly-freed page with a Reported buddy
    // so the cycle terminates after a single warm-up sweep.
    liveMounts = [
      ...(effectiveLiveMounts ?? []),
      { host: imgDir, guest: "/mnt/snap-src/img", mode: "ro" as const },
    ];
  } else {
    // Pack the bundle into a tar so machinen-restore.sh can untar it
    // off /dev/vdb. tar is `bsdtar` on darwin and `gnu tar` on linux;
    // both produce archives the guest's `tar -xmf` reads. The trailing
    // sparse extension keeps /dev/vdb at SNAP_SCRATCH_BYTES so chained
    // `vm.snapshot()` against this VM has scratch room (its mkfs.ext4
    // happily ignores tar bytes at the front).
    //
    // --no-xattrs: on darwin, Gatekeeper auto-tags files extracted by
    // `machinen snapshot` with `com.apple.provenance`, and bsdtar then
    // embeds them as `LIBARCHIVE.xattr.*` extended headers — which
    // GNU tar in the guest warns about once per file ("Ignoring
    // unknown extended header keyword"). CRIU images don't need
    // xattrs, so drop them at pack time.
    scratchPath = join(
      tmpdir(),
      `machinen-restore-bundle-${process.pid}-${randomBytes(6).toString("hex")}.tar`,
    );
    try {
      execFileSync("tar", ["--no-xattrs", "-cf", scratchPath, "-C", imgDir, "."]);
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
    liveMounts = effectiveLiveMounts;
  }
  phases.end("snapshot-pack");

  // #272: when the snapshot bundle includes a `--mount` overlay,
  // hand the lower/upper paths through to boot() so it can fd-pass
  // them to the VMM without re-running mksquashfs on the host source
  // dir. Each fork reflinks the upper into a per-VM file so guest
  // writes accumulate per-fork, not in the bundle.
  let restoreMountDisk: BootOptions["_restoreMountDisk"];
  if (meta.mountDisk) {
    const lowerAbs = join(snapDir, meta.mountDisk.lower);
    const upperAbs = join(snapDir, meta.mountDisk.upper);
    if (!existsSync(lowerAbs) || !existsSync(upperAbs)) {
      throw new BootError(
        "BOOT_SNAPSHOT_NOT_FOUND",
        `restore: bundle's mount overlay is missing one of:\n  ${lowerAbs}\n  ${upperAbs}`,
      );
    }
    restoreMountDisk = {
      guest: meta.mountDisk.guest,
      lowerPath: lowerAbs,
      upperPath: upperAbs,
    };
  }

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
      _restoreMountDisk: restoreMountDisk,
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

  autoNameRestoredFork(vm, opts, meta);

  // #274: persist lazy-restore bookkeeping so `vm.memoryStats()` can
  // report `lazyPagesTotal` without re-reading the bundle. Boot-owned
  // and attach handles both read this back through the registry.
  if (lazyPagesTotal !== undefined) {
    const cur = findEntry({ pid: vm.pid });
    if (cur) {
      writeEntry({
        ...cur,
        lazyPagesTotal,
      });
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

// Resolve the rootfs image for a restore: caller's `opts.image` wins,
// else the path the source booted from (recorded in meta.json). Both
// engines need a base rootfs — criu reopens file-backed VMAs against
// it; the vmstate engine materializes the restored guest's /dev/vda
// from it. Shared by the criu and vmstate restore paths.
function resolveRestoreImage(opts: RestoreOptions, meta: SnapshotMeta): string {
  if (opts.image) {
    const resolved = resolve(opts.cwd ?? process.cwd(), opts.image);
    if (!existsSync(resolved)) {
      throw new BootError("BOOT_IMAGE_NOT_FOUND", `restore: image not found: ${resolved}`);
    }
    return resolved;
  }
  if (meta.sourceImage && existsSync(meta.sourceImage)) {
    debugRestore("using meta.sourceImage path=%s", meta.sourceImage);
    return meta.sourceImage;
  }
  if (meta.sourceImage) {
    // The bundle remembers a path, but it's gone on this host (e.g.
    // restored on a different machine, or the tarball was deleted).
    throw new BootError(
      "BOOT_IMAGE_NOT_FOUND",
      `restore: source image not found at ${meta.sourceImage}\n` +
        `  The snapshot was taken with this rootfs tarball, and the restore\n` +
        `  needs it as the guest's base rootfs.\n` +
        `  • copy the tarball to that path on this host, OR\n` +
        `  • pass an explicit override via the runtime's restore({ image })\n` +
        `    or the CLI's \`machinen restore --image <tarball>\`.`,
    );
  }
  throw new BootError(
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

/**
 * Restore a vmstate (whole-VM) bundle: `<snapDir>/state.vmstate` plus
 * `meta.json`. Unlike the CRIU path there's no scratch tar and no
 * guest-side restore agent — `boot()` hands the state file to the VMM
 * via `_vmstateRestorePath` (→ `MACHINEN_RESTORE_PATH`), and the VMM
 * loads vCPU + RAM + GIC + virtio device state before the first vCPU
 * run, so the guest resumes mid-execution.
 *
 * The rootfs image and any `--mount` overlay are re-attached exactly
 * like the CRIU path — the vmstate captures VM state, not disks, so a
 * fresh /dev/vda is materialized from the same image (the disk-write
 * caveat is identical to CRIU's).
 */
async function restoreVmstate(opts: RestoreOptions, snapDir: string): Promise<VmHandle> {
  const statePath = join(snapDir, VMSTATE_FILE);
  const metaPath = join(snapDir, "meta.json");

  let meta: SnapshotMeta = { snappedAt: 0 };
  if (existsSync(metaPath)) {
    try {
      meta = JSON.parse(readFileSync(metaPath, "utf8")) as SnapshotMeta;
    } catch {
      // Corrupt / partial meta.json — fall through with an anonymous
      // source name. The restore still boots; it just won't get a
      // memorable auto-name.
    }
  }

  const resolvedImage = resolveRestoreImage(opts, meta);
  const effectiveLiveMounts = resolveRestoreLiveMounts(meta.liveMounts, opts.liveMounts);

  // Re-attach a `--mount` overlay recorded in the bundle (same shape
  // and per-fork reflink semantics as the CRIU path).
  let restoreMountDisk: BootOptions["_restoreMountDisk"];
  if (meta.mountDisk) {
    const lowerAbs = join(snapDir, meta.mountDisk.lower);
    const upperAbs = join(snapDir, meta.mountDisk.upper);
    if (!existsSync(lowerAbs) || !existsSync(upperAbs)) {
      throw new BootError(
        "BOOT_SNAPSHOT_NOT_FOUND",
        `restore: bundle's mount overlay is missing one of:\n  ${lowerAbs}\n  ${upperAbs}`,
      );
    }
    restoreMountDisk = { guest: meta.mountDisk.guest, lowerPath: lowerAbs, upperPath: upperAbs };
  }

  debugRestore("vmstate restore snapDir=%s state=%s image=%s", snapDir, statePath, resolvedImage);

  const vm = await boot({
    ...opts,
    image: resolvedImage,
    forkedFrom: snapDir,
    name: opts.name,
    liveMounts: effectiveLiveMounts,
    _restoreMountDisk: restoreMountDisk,
    _vmstateRestorePath: statePath,
  });

  autoNameRestoredFork(vm, opts, meta);
  // The restored guest's kernel hostname is whatever the source had;
  // re-stamp it with this VM's identity. Fire-and-forget over vsock.
  void setGuestHostname(vm, buildGuestHostname(vm.pid, vm.name)).catch(() => {});
  return vm;
}
