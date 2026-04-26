// Path containment for `--mount-live` (#78).
//
// The live-share server receives guest-supplied paths over vsock and
// performs filesystem ops on the host. Without containment, a crafted
// "../../etc/passwd" or a symlink planted inside the mount escapes to
// any file the host user can reach. `resolveUnderRoot` is the single
// primitive every op routes through.
//
// Algorithm:
//   1. Realpath the mount root once.
//   2. Join the guest path against root and realpath the result.
//      `realpath` follows symlinks fully, so a link inside the mount
//      that points outside resolves to an outside path.
//   3. Assert the resolved target is `rootReal` itself or has
//      `rootReal + sep` as a prefix. Anything else is an escape.
//
// For create/write ops (`mustExist: false`) the target doesn't exist
// yet, so we realpath its parent instead. The parent must already
// exist — guest can't mkdir `a/b/c` where `b` is missing, same as
// POSIX.
//
// Limitations kept deliberate for v0:
//  * Pure-Node, portable. macOS lacks `openat2(RESOLVE_BENEATH)` so
//    we can't get a kernel-enforced beneath-root op. A TOCTOU race
//    exists between realpath and the actual syscall. Acceptable here
//    because the only writer on the host is this server itself; we
//    gate symlink creation in `:rw` mode separately (MOUNT_PATH_ESCAPE
//    on create if the link target escapes).
//  * NUL-byte rejection, nothing else about encoding. Callers decode
//    bytes→string before handing off.

import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { MountError } from "./errors.ts";

export interface ResolveOptions {
  /**
   * `true` (default): the target must already exist; returns its
   * fully-resolved path. `false`: the target may not exist (create/
   * write ops); the parent must exist and be contained, and the
   * returned path is `<canonical-parent>/<basename>` with no symlink
   * following on the final component.
   */
  mustExist?: boolean;
}

/**
 * Resolve a guest-supplied path against a mount root, returning a
 * canonical host path that is guaranteed to lie beneath `rootAbs`
 * (or equal to it). Throws `MountError(MOUNT_PATH_ESCAPE)` if the
 * resolved path escapes, or `MountError(MOUNT_PATH_INVALID)` for
 * malformed input. Other errors (ENOENT, EACCES, ENAMETOOLONG) are
 * propagated unchanged.
 */
export async function resolveUnderRoot(
  rootAbs: string,
  guestRelative: string,
  opts: ResolveOptions = {},
): Promise<string> {
  const mustExist = opts.mustExist ?? true;

  if (!isAbsolute(rootAbs)) {
    throw new MountError("MOUNT_PATH_INVALID", `mount root must be absolute: ${rootAbs}`);
  }
  if (guestRelative.includes("\0")) {
    throw new MountError("MOUNT_PATH_INVALID", "null byte in guest path");
  }

  const rootReal = await realpath(rootAbs);
  // FUSE paths arrive kernel-rooted at the mount, so a leading slash
  // means "relative to the mount root", not "host absolute".
  const relStripped = guestRelative.replace(/^\/+/, "");
  const joined = resolve(rootReal, relStripped);

  try {
    const targetReal = await realpath(joined);
    assertContained(targetReal, rootReal);
    return targetReal;
  } catch (err) {
    const errno = (err as NodeJS.ErrnoException).code;
    if (errno !== "ENOENT" || mustExist) {
      throw err;
    }
  }

  const parentReal = await realpath(dirname(joined));
  assertContained(parentReal, rootReal);
  return join(parentReal, basename(joined));
}

function assertContained(targetReal: string, rootReal: string): void {
  if (targetReal === rootReal) {return;}
  if (targetReal.startsWith(rootReal + sep)) {return;}
  throw new MountError(
    "MOUNT_PATH_ESCAPE",
    `path escapes mount root: ${targetReal} is not under ${rootReal}`,
  );
}
