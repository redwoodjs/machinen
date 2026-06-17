import { statSync } from "node:fs";
import { join } from "node:path";

import { SnapshotError } from "../errors.ts";
import { reflinkCopy } from "../reflink.ts";
import type { SnapshotFileIdentity, VmstateSnapshotMeta } from "../vm-handle.ts";
import type { SnapshotContext } from "./snapshot.ts";
import { VMSTATE_ROOTDISK_FILE } from "./snapshot-engine.ts";
import {
  fileIdentity,
  fileSampleSha256,
  managedRootDiskSyntheticSha256,
  rememberTrustedFileIdentity,
  trustedFileIdentity,
  trustedManagedRootDisk,
} from "./vmstate-metadata.ts";

type PendingVmstateRootDisk =
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
  const identity =
    managedSnapshotRootDiskIdentity(rootDisk) ??
    trustedSnapshotRootDiskIdentity(rootDisk) ??
    fileIdentity(rootDisk.bundlePath);
  rememberTrustedFileIdentity(identity);
  return {
    mode: "block",
    file: rootDisk.file,
    path: rootDisk.path,
    sizeBytes: identity.sizeBytes,
    sha256: identity.sha256,
    trustedContentSample: identity.trustedContentSample,
  };
}

function managedSnapshotRootDiskIdentity(
  rootDisk: Extract<PendingVmstateRootDisk, { mode: "block" }>,
): SnapshotFileIdentity | undefined {
  const managed = trustedManagedRootDisk(rootDisk.path);
  if (!managed || statSync(rootDisk.bundlePath).size !== managed.sizeBytes) {
    return undefined;
  }
  const sampleSha256 = fileSampleSha256(rootDisk.bundlePath);
  return {
    path: rootDisk.bundlePath,
    sizeBytes: managed.sizeBytes,
    sha256: managedRootDiskSyntheticSha256(managed.sizeBytes, sampleSha256),
    trustedContentSample: {
      algorithm: "machinen-rootdisk-sample-v1",
      sha256: sampleSha256,
    },
  };
}

function trustedSnapshotRootDiskIdentity(
  rootDisk: Extract<PendingVmstateRootDisk, { mode: "block" }>,
): ReturnType<typeof fileIdentity> | undefined {
  const trusted = trustedFileIdentity(rootDisk.path);
  if (!trusted || statSync(rootDisk.bundlePath).size !== trusted.sizeBytes) {
    return undefined;
  }
  return { ...trusted, path: rootDisk.bundlePath };
}
