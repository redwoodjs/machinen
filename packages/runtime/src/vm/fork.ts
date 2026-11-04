// =============================================================
// Fork — #216
// =============================================================

import type { ForkOptions, VmHandle } from "../vm-handle.ts";
import { SnapshotError } from "../errors.ts";
import { performForkWithRestore } from "./fork-core.ts";
import { restore } from "./restore.ts";
import type { SnapshotContext } from "./snapshot.ts";

export function performFork(ctx: SnapshotContext, opts: ForkOptions): Promise<VmHandle> {
  if (ctx.guestOS === "macos") {
    throw new SnapshotError(
      "PROVIDER_UNSUPPORTED_OPERATION",
      "vm.fork: live fork is not implemented for macOS guests. " +
        "A cold clone of a stopped image is a separate future capability, " +
        "and cross-host memory migration is not supported.",
    );
  }
  return performForkWithRestore(ctx, opts, restore);
}

/**
 * Time-to-first-output-byte for a boot. Useful for measuring how
 * much the snapshot path is (or isn't) buying us.
 */
export function measureFirstByte(vm: VmHandle): Promise<number> {
  const started = Date.now();
  return new Promise((done, fail) => {
    vm.stderr.once("data", () => done(Date.now() - started));
    vm.stderr.once("error", fail);
  });
}
