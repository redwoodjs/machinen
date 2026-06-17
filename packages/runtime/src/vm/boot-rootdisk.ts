import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { BootError } from "../errors.ts";
import type { PhaseTimer } from "../phase-timer.ts";
import { reflinkCopy } from "../reflink.ts";
import { ensureRootfsImage, markRootfsImageClean } from "../rootfs-img.ts";
import { trustedRootfsTemplateIdentity } from "../rootfs-template-metadata.ts";
import { rememberManagedRootDisk, rememberTrustedFileIdentity } from "./vmstate-metadata.ts";
import type { BootOptions } from "./boot.ts";

// Materialize the rootdisk image and reflink it into a per-boot path
// so guest writes don't leak across boots. Returns the per-boot
// reflink path so the exit hook can unlink it; undefined when the
// caller passed a pre-built image (`rootDisk: '<path>'`) — that
// file's lifecycle is the caller's.
export function materializeRootdisk(
  opts: BootOptions,
  env: Record<string, string>,
  phases: PhaseTimer,
): string | undefined {
  if (opts._rootDiskRestorePath) {
    return materializeRestoredRootdisk(opts, env, phases);
  }
  if (typeof opts.rootDisk === "string") {
    const rootDiskAbs = resolve(opts.cwd ?? process.cwd(), opts.rootDisk);
    if (!existsSync(rootDiskAbs)) {
      throw new BootError("BOOT_IMAGE_NOT_FOUND", `rootDisk image not found: ${rootDiskAbs}`);
    }
    env.MACHINEN_ROOTDISK = rootDiskAbs;
    return undefined;
  }
  return materializeCachedRootdisk(opts, env, phases);
}

function materializeRestoredRootdisk(
  opts: BootOptions,
  env: Record<string, string>,
  phases: PhaseTimer,
): string {
  const rootDiskAbs = resolve(opts.cwd ?? process.cwd(), opts._rootDiskRestorePath!);
  if (!existsSync(rootDiskAbs)) {
    throw new BootError(
      "BOOT_SNAPSHOT_NOT_FOUND",
      `restore: vmstate rootdisk image not found: ${rootDiskAbs}`,
    );
  }
  const perBoot = join(
    tmpdir(),
    `machinen-rootdisk-restore-${process.pid}-${randomBytes(6).toString("hex")}.img`,
  );
  const reflinkT0 = Date.now();
  reflinkCopy(rootDiskAbs, perBoot);
  phases.mark("rootdisk-materialize.restore-reflink", Date.now() - reflinkT0);
  env.MACHINEN_ROOTDISK = perBoot;
  return perBoot;
}

function materializeCachedRootdisk(
  opts: BootOptions,
  env: Record<string, string>,
  phases: PhaseTimer,
): string {
  // #121: hand the VMM a per-boot reflink clone of the cached
  // template, never the template itself. virtio-blk mounts the
  // image read-write, so without the clone every boot from the
  // same tarball would inherit the previous boot's writes.
  const baseAbs = resolve(opts.cwd ?? process.cwd(), opts.image!);
  const cachedImg = ensureRootfsImage(baseAbs, {
    sizeBytes: opts.rootDiskSizeBytes,
    onPhase: (name, ms) => phases.mark(`rootdisk-materialize.${name}`, ms),
  });
  const perBoot = join(
    tmpdir(),
    `machinen-rootdisk-${process.pid}-${randomBytes(6).toString("hex")}.img`,
  );
  const trustedTemplateIdentity = trustedRootfsTemplateIdentity(cachedImg);
  const reflinkT0 = Date.now();
  reflinkCopy(cachedImg, perBoot);
  phases.mark("rootdisk-materialize.reflink", Date.now() - reflinkT0);
  if (trustedTemplateIdentity) {
    rememberTrustedFileIdentity({ ...trustedTemplateIdentity, path: perBoot });
    rememberManagedRootDisk(perBoot);
  }
  // The cache file was only READ here — restore the clean-shutdown
  // marker so the next boot finds a usable template instead of wiping
  // and rematerializing (#170).
  markRootfsImageClean(cachedImg);
  env.MACHINEN_ROOTDISK = perBoot;
  return perBoot;
}
