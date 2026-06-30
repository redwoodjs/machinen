import { BootError } from "../errors.ts";
import type { SnapshotMeta } from "../vm-handle.ts";

export function refuseMultiVcpuRestore(meta: SnapshotMeta): void {
  if ((meta.cpu?.maxVcpus ?? 1) <= 1) {
    return;
  }
  throw new BootError(
    "BOOT_VMSTATE_UNSUPPORTED",
    "restore: multi-vCPU snapshot bundles are not supported yet.\n" +
      "  Machinen does not yet restore every vCPU, timer, and interrupt-controller state safely.",
  );
}
