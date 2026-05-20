// Unified error model for @machinen/runtime (#102).
//
// One base class (`MachinenError`) carrying a flat `code` string, a
// `retryable` hint, and a `cause` chain. Thin category subclasses
// (`BootError`, `ProvisionError`, `ExecError`, `RegistryError`,
// `CacheError`, `GvproxyError`, `MkinitramfsError`, `ParseError`) are
// purely for `instanceof` filtering — all semantics live on the code.
//
// Usage:
//
//   throw new BootError("BOOT_VMM_MISSING", `VMM binary not found at ${bin}`);
//   throw new ExecError("EXEC_AGENT_TIMEOUT", "agent timed out", {
//     retryable: true,
//     cause: err,
//   });
//
//   if (isMachinenError(err, "BOOT_VMM_MISSING")) { ... }     // narrow by code
//   if (isMachinenError(err) && err.retryable)   { ... }      // generic filter
//
// TypeScript has no `throws` clause; we rely on the code being a const
// enum (typos don't compile) and JSDoc `@throws` for documentation.

export const ErrorCode = {
  // boot — VM lifecycle, binary lookup, config validation
  BOOT_VMM_MISSING: "BOOT_VMM_MISSING",
  BOOT_VMM_PACKAGE_BROKEN: "BOOT_VMM_PACKAGE_BROKEN",
  BOOT_IMAGE_NOT_FOUND: "BOOT_IMAGE_NOT_FOUND",
  BOOT_SNAPSHOT_NOT_FOUND: "BOOT_SNAPSHOT_NOT_FOUND",
  BOOT_KERNEL_NOT_FOUND: "BOOT_KERNEL_NOT_FOUND",
  BOOT_DTB_NOT_FOUND: "BOOT_DTB_NOT_FOUND",
  BOOT_CMD_WITHOUT_IMAGE: "BOOT_CMD_WITHOUT_IMAGE",
  BOOT_CMD_MISSING: "BOOT_CMD_MISSING",
  BOOT_CWD_INVALID: "BOOT_CWD_INVALID",
  BOOT_MOUNT_INVALID: "BOOT_MOUNT_INVALID",
  BOOT_MOUNT_HOST_NOT_FOUND: "BOOT_MOUNT_HOST_NOT_FOUND",
  BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN: "BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN",
  BOOT_PORT_FORWARD_INVALID: "BOOT_PORT_FORWARD_INVALID",
  BOOT_PORT_FORWARD_CONFLICT: "BOOT_PORT_FORWARD_CONFLICT",
  BOOT_PORT_FORWARD_NO_GVPROXY: "BOOT_PORT_FORWARD_NO_GVPROXY",
  BOOT_PORT_FORWARD_IN_USE: "BOOT_PORT_FORWARD_IN_USE",
  BOOT_PACK_FAILED: "BOOT_PACK_FAILED",
  BOOT_TIMEOUT: "BOOT_TIMEOUT",
  BOOT_DETACHED_READINESS_FAILED: "BOOT_DETACHED_READINESS_FAILED",
  BOOT_MEMORY_INVALID: "BOOT_MEMORY_INVALID",
  BOOT_NESTED_VIRT_UNSUPPORTED: "BOOT_NESTED_VIRT_UNSUPPORTED",
  BOOT_VMSTATE_UNSUPPORTED: "BOOT_VMSTATE_UNSUPPORTED",
  BOOT_VMSTATE_RESEED_FAILED: "BOOT_VMSTATE_RESEED_FAILED",
  BOOT_PORTABLE_UNSUPPORTED: "BOOT_PORTABLE_UNSUPPORTED",
  FORK_MEMORY_BACKPRESSURE: "FORK_MEMORY_BACKPRESSURE",
  // mountdisk — `--mount` squashfs+ext4 overlay (#272)
  BOOT_MOUNTDISK_TOOL_MISSING: "BOOT_MOUNTDISK_TOOL_MISSING",

  // exec — vsock command execution
  EXEC_VSOCK_UNAVAILABLE: "EXEC_VSOCK_UNAVAILABLE",
  EXEC_AGENT_UNAVAILABLE: "EXEC_AGENT_UNAVAILABLE",
  EXEC_AGENT_TIMEOUT: "EXEC_AGENT_TIMEOUT",
  EXEC_NONZERO_EXIT: "EXEC_NONZERO_EXIT",
  EXEC_PROTOCOL: "EXEC_PROTOCOL",

  // snapshot — CRIU-based VM snapshotting
  SNAPSHOT_NO_DISK: "SNAPSHOT_NO_DISK",
  SNAPSHOT_DUMP_FAILED: "SNAPSHOT_DUMP_FAILED",
  SNAPSHOT_TIMEOUT: "SNAPSHOT_TIMEOUT",
  SNAPSHOT_PORTABLE_UNSUPPORTED: "SNAPSHOT_PORTABLE_UNSUPPORTED",

  // provision — image builder
  PROVISION_BASE_NOT_FOUND: "PROVISION_BASE_NOT_FOUND",
  PROVISION_KERNEL_NOT_FOUND: "PROVISION_KERNEL_NOT_FOUND",
  PROVISION_DTB_NOT_FOUND: "PROVISION_DTB_NOT_FOUND",
  PROVISION_ASSETS_DIR_INVALID: "PROVISION_ASSETS_DIR_INVALID",
  PROVISION_INSTALL_HOOK_FAILED: "PROVISION_INSTALL_HOOK_FAILED",
  PROVISION_DISK_TOO_SMALL: "PROVISION_DISK_TOO_SMALL",

  // rootfs-img — tar→ext4 materializer (#114, #120)
  ROOTFS_IMG_TOOL_MISSING: "ROOTFS_IMG_TOOL_MISSING",

  // registry / attach
  REGISTRY_VM_NOT_FOUND: "REGISTRY_VM_NOT_FOUND",
  REGISTRY_NAME_IN_USE: "REGISTRY_NAME_IN_USE",

  // files — vsock push/pull
  FILES_HOST_DIR_NOT_FOUND: "FILES_HOST_DIR_NOT_FOUND",
  FILES_AGENT_UNAVAILABLE: "FILES_AGENT_UNAVAILABLE",

  // mount — live-share (--mount-live, #78). Path containment is the
  // load-bearing piece: any resolver failure means the guest tried to
  // reach outside the mounted directory.
  MOUNT_PATH_INVALID: "MOUNT_PATH_INVALID",
  MOUNT_PATH_ESCAPE: "MOUNT_PATH_ESCAPE",

  // secrets — vsock KEY=VALUE injection
  SECRETS_VALUE_INVALID: "SECRETS_VALUE_INVALID",
  SECRETS_AGENT_UNAVAILABLE: "SECRETS_AGENT_UNAVAILABLE",

  // winsize — vsock resize forwarder
  WINSIZE_AGENT_UNAVAILABLE: "WINSIZE_AGENT_UNAVAILABLE",

  // multiplex — sandbox registry
  SANDBOX_ID_DUPLICATE: "SANDBOX_ID_DUPLICATE",
  SANDBOX_ID_UNKNOWN: "SANDBOX_ID_UNKNOWN",

  // cache — host-side artifact mirror
  CACHE_BIND_FAILED: "CACHE_BIND_FAILED",

  // gvproxy — user-mode network bridge
  GVPROXY_NOT_FOUND: "GVPROXY_NOT_FOUND",
  GVPROXY_EXPOSE_FAILED: "GVPROXY_EXPOSE_FAILED",
  GVPROXY_PORT_IN_USE: "GVPROXY_PORT_IN_USE",
  GVPROXY_INSTALL_FAILED: "GVPROXY_INSTALL_FAILED",
  GVPROXY_SPAWN_FAILED: "GVPROXY_SPAWN_FAILED",

  // mkinitramfs — initramfs packer
  MKINITRAMFS_BUNDLE_INVALID: "MKINITRAMFS_BUNDLE_INVALID",
  MKINITRAMFS_WORKSPACE_INVALID: "MKINITRAMFS_WORKSPACE_INVALID",
  MKINITRAMFS_WORKSPACE_TOO_LARGE: "MKINITRAMFS_WORKSPACE_TOO_LARGE",
  MKINITRAMFS_BASE_EXTRACT_FAILED: "MKINITRAMFS_BASE_EXTRACT_FAILED",
  MKINITRAMFS_INIT_MISSING: "MKINITRAMFS_INIT_MISSING",

  // parse — CLI arg parser
  PARSE_FLAG_UNKNOWN: "PARSE_FLAG_UNKNOWN",
  PARSE_FLAG_MISSING_VALUE: "PARSE_FLAG_MISSING_VALUE",
  PARSE_FLAG_DUPLICATE: "PARSE_FLAG_DUPLICATE",
  PARSE_FLAG_MALFORMED: "PARSE_FLAG_MALFORMED",
  PARSE_PORT_INVALID: "PARSE_PORT_INVALID",
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface MachinenErrorOptions {
  /**
   * True if retrying the same call could plausibly succeed (transient
   * network blip, upstream fetch, vsock agent not listening yet). False
   * for misconfiguration (missing binary, bad mount path, invalid
   * port).
   */
  retryable?: boolean;
  /** Underlying error preserved via the standard `Error.cause` chain. */
  cause?: unknown;
}

/**
 * Base class for every error raised by @machinen/runtime and
 * @machinen/cli. Carries a flat `code`, a `retryable` hint, and the
 * underlying cause via the standard `Error.cause` mechanism.
 */
export class MachinenError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;

  constructor(code: ErrorCode, message: string, opts: MachinenErrorOptions = {}) {
    super(message, { cause: opts.cause });
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.name = new.target.name;
  }
}

// Category subclasses. Purely for `instanceof` filtering — no behavior.
export class BootError extends MachinenError {}
export class ExecError extends MachinenError {}
export class SnapshotError extends MachinenError {}
export class ProvisionError extends MachinenError {}
export class RegistryError extends MachinenError {}
export class FilesError extends MachinenError {}
export class MountError extends MachinenError {}
export class SecretsError extends MachinenError {}
export class WinsizeError extends MachinenError {}
export class SandboxError extends MachinenError {}
export class CacheError extends MachinenError {}
export class GvproxyError extends MachinenError {}
export class MkinitramfsError extends MachinenError {}
export class ParseError extends MachinenError {}

/**
 * Narrowing type guard. Pass a specific `code` to check both identity
 * and discriminant in one call.
 */
export function isMachinenError(err: unknown, code?: ErrorCode): err is MachinenError {
  return err instanceof MachinenError && (code === undefined || err.code === code);
}

/**
 * Format a MachinenError for CLI stderr. Shows the code inline and walks
 * the `cause` chain. Used by the CLI's unified `handleError`; exported so
 * library callers can adopt the same format if they want to.
 */
export function formatMachinenError(err: MachinenError): string {
  const lines: string[] = [`(${err.code}): ${err.message}`];
  let cur: unknown = err.cause;
  while (cur !== undefined && cur !== null) {
    const msg = cur instanceof Error ? cur.message : String(cur);
    lines.push(`  caused by: ${msg}`);
    cur = cur instanceof Error ? (cur as Error & { cause?: unknown }).cause : undefined;
  }
  return lines.join("\n");
}
