// Guest-OS refusals shared by snapshot, fork, and restore.
//
// Kept in one place so the three call sites cannot drift into different
// wording, and so a macOS guest fails with the same reason regardless of
// which entry point a caller reaches.

import { BootError, SnapshotError } from "../errors.ts";
import type { GuestOS } from "./types.ts";

const MACOS_REASONS = {
  snapshot:
    "macOS guests cannot be snapshotted. Apple saved state is encrypted to the " +
    "originating host and is not a portable Machinen bundle, so writing one here " +
    "would produce a file that cannot be restored elsewhere.",
  fork:
    "live fork is not implemented for macOS guests. A cold clone of a stopped image " +
    "is a separate future capability, and cross-host memory migration is not supported.",
  restore:
    "a macOS guest cannot be restored from a snapshot bundle. Apple saved state is " +
    "encrypted to the originating host and is not a portable Machinen bundle, and " +
    "this provider implements no restore.",
} as const;

export type RefusedOperation = keyof typeof MACOS_REASONS;

/**
 * Throw when the guest OS cannot perform `operation`. Linux is always
 * allowed, so this is a no-op on the default path.
 */
export function assertOperationSupported(
  guestOS: GuestOS | undefined,
  operation: RefusedOperation,
  makeError: (message: string) => Error = defaultError,
): void {
  if (guestOS !== "macos") {
    return;
  }
  throw makeError(`vm.${operation}: ${MACOS_REASONS[operation]}`);
}

/** Snapshot-path variant, which uses the snapshot error category. */
export function assertSnapshotSupported(
  guestOS: GuestOS | undefined,
  operation: RefusedOperation,
): void {
  assertOperationSupported(guestOS, operation, (message) => {
    return new SnapshotError("PROVIDER_UNSUPPORTED_OPERATION", message);
  });
}

function defaultError(message: string): Error {
  return new BootError("PROVIDER_UNSUPPORTED_OPERATION", message);
}
