import { createHash } from "node:crypto";

import { resolveBaseDtb, resolveBaseKernel } from "../base-assets.ts";
import { BootError, SnapshotError } from "../errors.ts";
import type { PhaseTimer } from "../phase-timer.ts";
import type { SnapshotFileIdentity, VmstateSnapshotMeta } from "../vm-handle.ts";
import { validateIdentity } from "./restore-identity.ts";
import { fileIdentity } from "./vmstate-metadata.ts";

interface ShellSnapshotSource {
  sourceImage?: string;
  kernelPath?: string;
  dtbPath?: string;
}

interface ShellRestoreOptions {
  cwd?: string;
  kernel?: string;
  dtb?: string;
}

type VmstateShellIdentity = NonNullable<VmstateSnapshotMeta["shell"]>;

function buildVmstateShellIdentity(args: {
  rootfsPath: string;
  kernelPath: string;
  dtbPath?: string;
}): VmstateShellIdentity {
  const shell = {
    rootfs: fileIdentity(args.rootfsPath),
    kernel: fileIdentity(args.kernelPath),
    ...(args.dtbPath ? { dtb: fileIdentity(args.dtbPath) } : {}),
  };
  return { ...shell, id: vmstateShellId(shell) };
}

export function vmstateShellId(shell: Omit<VmstateShellIdentity, "id">): string {
  const h = createHash("sha256");
  h.update("machinen-vmstate-shell-v1\0");
  updateShellIdentityPart(h, "rootfs", shell.rootfs);
  updateShellIdentityPart(h, "kernel", shell.kernel);
  if (shell.dtb) {
    updateShellIdentityPart(h, "dtb", shell.dtb);
  } else {
    h.update("dtb\0absent\0");
  }
  return h.digest("hex");
}

function updateShellIdentityPart(
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

export function snapshotVmstateShellIdentity(
  ctx: ShellSnapshotSource,
): VmstateSnapshotMeta["shell"] {
  if (!ctx.sourceImage) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: cannot record vmstate shell identity because the source rootfs image is unknown.\n" +
        "  Reboot with a current runtime/CLI so the registry records the rootfs tarball.",
    );
  }
  if (!ctx.kernelPath) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      "vm.snapshot: cannot record vmstate shell identity because the source kernel image is unknown.\n" +
        "  Boot with an explicit kernel path or through the CLI base-asset resolver.",
    );
  }
  return buildVmstateShellIdentity({
    rootfsPath: ctx.sourceImage,
    kernelPath: ctx.kernelPath,
    dtbPath: ctx.dtbPath,
  });
}

export function validateVmstateShell(args: {
  opts: ShellRestoreOptions;
  vmstate: VmstateSnapshotMeta;
  resolvedImage: string;
  phases?: PhaseTimer;
}): void {
  const expected = args.vmstate.shell;
  if (!expected) {
    throw new BootError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "restore: vmstate bundle has no shell identity metadata.\n" +
        "  A whole-VM restore must use the same rootfs/kernel/DTB shell that\n" +
        "  the frozen RAM, vCPU state, and device model expect. Recreate the\n" +
        "  snapshot with a current machinen build.",
    );
  }
  const cwd = args.opts.cwd ?? process.cwd();
  const kernel = resolveBaseKernel(args.opts.kernel, cwd);
  const dtb = resolveBaseDtb(args.opts.dtb, cwd);
  validateShellId(expected);
  validateIdentity("rootfs", args.resolvedImage, expected.rootfs, args.phases, "external");
  validateIdentity("kernel", kernel, expected.kernel, args.phases, "external");
  validateVmstateShellDtb(expected.dtb, dtb, args.phases);
}

function validateShellId(expected: NonNullable<VmstateSnapshotMeta["shell"]>): void {
  const actualId = vmstateShellId(expected);
  if (expected.id === actualId) {
    return;
  }
  throw new BootError(
    "BOOT_VMSTATE_UNSUPPORTED",
    `restore: vmstate shell identity id is inconsistent with its artifact digests.\n` +
      `  expected id: ${expected.id}\n` +
      `  digest id:   ${actualId}`,
  );
}

function validateVmstateShellDtb(
  expected: NonNullable<VmstateSnapshotMeta["shell"]>["dtb"],
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
    `restore: vmstate DTB shell mismatch.\n` +
      `  snapshot dtb: ${expected ? "present" : "absent"}\n` +
      `  restore dtb:  ${actualPath ? "present" : "absent"}\n` +
      "  vmstate restore requires the same rootfs/kernel/DTB shell.",
  );
}
