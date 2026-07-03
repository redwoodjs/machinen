import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";

import { BootError } from "../errors.ts";
import { reflinkCopy } from "../reflink.ts";
import type { BootOptions } from "./boot.ts";
import { allocateSparseFile, SNAP_SCRATCH_BYTES } from "./helpers.ts";

const debug = debugLib("machinen:boot");

type ScratchMode = "false" | "path" | "auto";

interface ScratchDiskPlan {
  action: "none" | "existing" | "clone" | "allocate";
  diskPath: string | null;
  perBootSnapDisk: string | null;
  vmmDisk: string | null;
}

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
export function prepareScratchDisk(
  opts: BootOptions,
  env: Record<string, string>,
): { diskAbs: string | undefined; perBootSnapDisk: string | undefined } {
  const snapshotPath = resolveSnapshotDiskPath(opts);
  const scratchPlan = planScratchDisk({
    mode: planScratchMode(opts.snapshot),
    hasCmd: opts.cmd !== undefined,
    hasImage: opts.image !== undefined,
    snapshotPath,
    restoreClonePath: snapshotPath ? scratchRestoreClonePath() : undefined,
    autoPath: opts.snapshot === undefined ? autoScratchPath() : undefined,
  });
  applyScratchDiskPlan(scratchPlan, snapshotPath, env);
  return {
    diskAbs: scratchPlan.diskPath ?? undefined,
    perBootSnapDisk: scratchPlan.perBootSnapDisk ?? undefined,
  };
}

function planScratchMode(snapshot: BootOptions["snapshot"]): ScratchMode {
  if (snapshot === false) {
    return "false";
  }
  return typeof snapshot === "string" ? "path" : "auto";
}

function planScratchDisk(input: {
  mode: ScratchMode;
  hasCmd: boolean;
  hasImage: boolean;
  snapshotPath?: string;
  restoreClonePath?: string;
  autoPath?: string;
}): ScratchDiskPlan {
  if (input.mode === "false") {
    return noScratchDiskPlan();
  }
  return input.mode === "path" ? planPathScratchDisk(input) : planAutoScratchDisk(input);
}

function noScratchDiskPlan(): ScratchDiskPlan {
  return { action: "none", diskPath: null, perBootSnapDisk: null, vmmDisk: null };
}

function planPathScratchDisk(input: {
  hasCmd: boolean;
  snapshotPath?: string;
  restoreClonePath?: string;
}): ScratchDiskPlan {
  const snapshotPath = requireScratchPath(input.snapshotPath);
  if (input.hasCmd) {
    return {
      action: "existing",
      diskPath: snapshotPath,
      perBootSnapDisk: null,
      vmmDisk: snapshotPath,
    };
  }
  const restoreClonePath = requireScratchPath(input.restoreClonePath);
  return {
    action: "clone",
    diskPath: restoreClonePath,
    perBootSnapDisk: restoreClonePath,
    vmmDisk: restoreClonePath,
  };
}

function planAutoScratchDisk(input: { hasImage: boolean; autoPath?: string }): ScratchDiskPlan {
  if (!input.hasImage) {
    return noScratchDiskPlan();
  }
  const autoPath = requireScratchPath(input.autoPath);
  return {
    action: "allocate",
    diskPath: autoPath,
    perBootSnapDisk: autoPath,
    vmmDisk: autoPath,
  };
}

function requireScratchPath(path: string | undefined): string {
  if (!path) {
    throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", "boot-plan scratch disk path missing");
  }
  return path;
}

function resolveSnapshotDiskPath(opts: BootOptions): string | undefined {
  if (typeof opts.snapshot !== "string") {
    return undefined;
  }
  const bundleDisk = resolve(opts.cwd ?? process.cwd(), opts.snapshot);
  if (!existsSync(bundleDisk)) {
    throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", `snapshot image not found: ${bundleDisk}`);
  }
  return bundleDisk;
}

function scratchRestoreClonePath(): string {
  return scratchTempPath("restore");
}

function autoScratchPath(): string {
  return scratchTempPath("auto");
}

function scratchTempPath(kind: "restore" | "auto"): string {
  const nonce = randomBytes(6).toString("hex");
  const prefix = kind === "restore" ? "machinen-snap-restore" : "machinen-snap";
  return join(tmpdir(), `${prefix}-${process.pid}-${nonce}.img`);
}

function applyScratchDiskPlan(
  plan: ScratchDiskPlan,
  snapshotPath: string | undefined,
  env: Record<string, string>,
): void {
  if (plan.vmmDisk) {
    env.MACHINEN_DISK = plan.vmmDisk;
  }
  if (plan.action === "existing") {
    debug("snap-restore in-place (explicit cmd) path=%s", plan.diskPath);
    return;
  }
  if (plan.action === "clone") {
    reflinkCopy(snapshotPath!, plan.diskPath!);
    debug("snap-restore reflink-clone src=%s dst=%s", snapshotPath, plan.diskPath);
    return;
  }
  if (plan.action === "allocate") {
    allocateSparseFile(plan.diskPath!, SNAP_SCRATCH_BYTES);
    debug("snap-scratch auto path=%s sizeBytes=%d", plan.diskPath, SNAP_SCRATCH_BYTES);
  }
}
