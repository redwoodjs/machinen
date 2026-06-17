import { join } from "node:path";

import { SnapshotError } from "../errors.ts";
import { reflinkCopy } from "../reflink.ts";
import type { VmstateSnapshotMeta } from "../vm-handle.ts";
import type { SnapshotContext } from "./snapshot.ts";
import { VMSTATE_ROOTDISK_FILE } from "./snapshot-engine.ts";
import { fileIdentity, rememberTrustedFileIdentity } from "./vmstate-metadata.ts";

export type PendingVmstateRootDisk =
  | { mode: "block"; file: string; path: string; bundlePath: string }
  | { mode: "delta" }
  | { mode: "none" };

export function copyVmstateRootDisk(
  ctx: SnapshotContext,
  snapDir: string,
  deltaOnly: boolean,
): PendingVmstateRootDisk {
  if (ctx.rootDiskMode === "none") {
    return { mode: "none" };
  }
  if (!ctx.rootDiskPath) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: cannot record vmstate rootdisk identity for this VM.\n" +
        "  Reboot it with the current runtime so the registry records /dev/vda,\n" +
        "  or boot with rootDisk:false if the guest intentionally has no root block device.",
    );
  }
  if (deltaOnly) {
    return { mode: "delta" };
  }
  const dest = join(snapDir, VMSTATE_ROOTDISK_FILE);
  try {
    reflinkCopy(ctx.rootDiskPath, dest);
  } catch (err) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      `vm.snapshot: failed to copy rootdisk into vmstate bundle: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
  return {
    mode: "block",
    file: VMSTATE_ROOTDISK_FILE,
    path: ctx.rootDiskPath,
    bundlePath: dest,
  };
}

export function finalizeVmstateRootDisk(
  rootDisk: PendingVmstateRootDisk,
): VmstateSnapshotMeta["rootDisk"] {
  if (rootDisk.mode !== "block") {
    return rootDisk;
  }
  const identity = fileIdentity(rootDisk.bundlePath);
  rememberTrustedFileIdentity(identity);
  return {
    mode: "block",
    file: rootDisk.file,
    path: rootDisk.path,
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
  };
}
