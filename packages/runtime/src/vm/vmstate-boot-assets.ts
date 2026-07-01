import { createHash } from "node:crypto";

import { resolveBaseDtb, resolveBaseKernel } from "../base-assets.ts";
import { BootError, SnapshotError } from "../errors.ts";
import type { PhaseTimer } from "../phase-timer.ts";
import type { SnapshotFileIdentity, VmstateSnapshotMeta } from "../vm-handle.ts";
import { validateIdentity } from "./restore-identity.ts";
import { fileIdentity } from "./vmstate-metadata.ts";

interface BootAssetsSnapshotSource {
  sourceImage?: string;
  kernelPath?: string;
  dtbPath?: string;
}

interface BootAssetsRestoreOptions {
  cwd?: string;
  kernel?: string;
  dtb?: string;
}

type VmstateBootAssetsIdentity = NonNullable<VmstateSnapshotMeta["bootAssets"]>;

function buildVmstateBootAssetsIdentity(args: {
  rootfsPath: string;
  kernelPath: string;
  dtbPath?: string;
}): VmstateBootAssetsIdentity {
  const bootAssets = {
    rootfs: fileIdentity(args.rootfsPath),
    kernel: fileIdentity(args.kernelPath),
    ...(args.dtbPath ? { dtb: fileIdentity(args.dtbPath) } : {}),
  };
  return { ...bootAssets, id: vmstateBootAssetsId(bootAssets) };
}

export function vmstateBootAssetsId(bootAssets: Omit<VmstateBootAssetsIdentity, "id">): string {
  const h = createHash("sha256");
  h.update("machinen-vmstate-boot-assets-v1\0");
  updateBootAssetsIdentityPart(h, "rootfs", bootAssets.rootfs);
  updateBootAssetsIdentityPart(h, "kernel", bootAssets.kernel);
  if (bootAssets.dtb) {
    updateBootAssetsIdentityPart(h, "dtb", bootAssets.dtb);
  } else {
    h.update("dtb\0absent\0");
  }
  return h.digest("hex");
}

function updateBootAssetsIdentityPart(
  h: ReturnType<typeof createHash>,
  label: string,
  identity: SnapshotFileIdentity,
): void {
  h.update(label);
  h.update("\0");
  h.update(String(identity.sizeBytes));
  h.update("\0");
  h.update(identity.sha256);
  h.update("\0");
}

export function snapshotVmstateBootAssetsIdentity(
  ctx: BootAssetsSnapshotSource,
  opts: { guestArch?: VmstateSnapshotMeta["guestArch"] } = {},
): VmstateSnapshotMeta["bootAssets"] {
  if (!ctx.sourceImage) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: cannot record vmstate boot asset identity because the source rootfs image is unknown.\n" +
        "  Reboot with a current runtime/CLI so the registry records the rootfs tarball.",
    );
  }
  if (!ctx.kernelPath) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: cannot record vmstate boot asset identity because the source kernel image is unknown.\n" +
        "  Reboot with a current runtime/CLI so the registry records the kernel path.",
    );
  }
  if (opts.guestArch === "arm64" && !ctx.dtbPath) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: cannot record vmstate boot asset identity because the source DTB is unknown.\n" +
        "  Reboot with a current runtime/CLI so the registry records the DTB path.",
    );
  }
  return buildVmstateBootAssetsIdentity({
    rootfsPath: ctx.sourceImage,
    kernelPath: ctx.kernelPath,
    dtbPath: ctx.dtbPath,
  });
}

export function validateVmstateBootAssets(args: {
  opts: BootAssetsRestoreOptions;
  vmstate: VmstateSnapshotMeta;
  resolvedImage: string;
  phases?: PhaseTimer;
}): void {
  const expected = args.vmstate.bootAssets;
  if (!expected) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: vmstate bundle has no boot asset metadata.\n" +
        "  A whole-VM restore must use the same rootfs/kernel/DTB boot assets that\n" +
        "  the frozen RAM, vCPU state, and device model expect. Recreate the\n" +
        "  snapshot with a current machinen build.",
    );
  }
  const cwd = args.opts.cwd ?? process.cwd();
  const kernel = resolveBaseKernel(args.opts.kernel, cwd);
  const dtb = resolveBaseDtb(args.opts.dtb, cwd);
  validateBootAssetsId(expected);
  validateIdentity("rootfs", args.resolvedImage, expected.rootfs, args.phases, "external");
  validateIdentity("kernel", kernel, expected.kernel, args.phases, "external");
  validateVmstateBootAssetsDtb(expected.dtb, dtb, args.phases);
}

function validateBootAssetsId(expected: NonNullable<VmstateSnapshotMeta["bootAssets"]>): void {
  const actualId = vmstateBootAssetsId(expected);
  if (expected.id === actualId) {
    return;
  }
  throw new BootError(
    "BOOT_VMSTATE_UNSUPPORTED",
    `restore: vmstate boot asset id is inconsistent with its artifact digests.\n` +
      `  expected id: ${expected.id}\n` +
      `  digest id:   ${actualId}`,
  );
}

function validateVmstateBootAssetsDtb(
  expected: NonNullable<VmstateSnapshotMeta["bootAssets"]>["dtb"],
  actualPath: string | undefined,
  phases?: PhaseTimer,
): void {
  if (!expected && !actualPath) {
    return;
  }
  if (expected && actualPath) {
    validateIdentity("dtb", actualPath, expected, phases, "external");
    return;
  }
  throw new BootError(
    "BOOT_VMSTATE_UNSUPPORTED",
    `restore: vmstate DTB boot asset mismatch.\n` +
      `  snapshot dtb: ${expected ? "present" : "absent"}\n` +
      `  restore dtb:  ${actualPath ? "present" : "absent"}\n` +
      "  vmstate restore requires the same rootfs/kernel/DTB boot assets.",
  );
}
