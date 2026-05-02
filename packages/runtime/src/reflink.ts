// #221 follow-up — fast reflink/CoW copy.
//
// Why this exists: Node's `fs.copyFileSync(src, dst, COPYFILE_FICLONE)`
// on macOS goes through the BSD `copyfile(3)` library function (with
// CLONE flag), not the underlying `clonefile(2)` syscall. `copyfile(3)`
// does extra ACL/metadata bookkeeping that scales with file size — for
// a 2 GiB rootdisk image we measured ~635 ms there, vs ~20 ms for
// `cp -c` (which calls `clonefile(2)` directly). On every warm boot
// this was 73 % of `rootdisk-materialize`. See issue #221.
//
// On Linux, libuv's COPYFILE_FICLONE path uses the FICLONE ioctl
// directly and is already fast — no need to special-case.
//
// Strategy:
//   - Darwin: spawnSync `/bin/cp -c src dst`. Process spawn is ~5 ms,
//     dwarfed by the saving. If it fails (e.g. cross-volume — clonefile
//     is volume-local), fall back to plain copyFileSync without the
//     reflink flag (correctness over speed for the rare cross-volume
//     case).
//   - Everywhere else: stay on `copyFileSync(... COPYFILE_FICLONE)`
//     which is the right primitive on Linux/BSD.

import { spawnSync } from "node:child_process";
import { constants as fsConstants, copyFileSync } from "node:fs";
import { platform } from "node:os";

/**
 * Reflink-clone `src` to `dst`. The destination must NOT exist (same
 * contract as `clonefile(2)`). Falls back to a regular byte copy on
 * filesystems that don't support reflinks.
 */
export function reflinkCopy(src: string, dst: string): void {
  if (platform() === "darwin") {
    const res = spawnSync("/bin/cp", ["-c", src, dst], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (res.status === 0) {
      return;
    }
    // `cp -c` failed (cross-volume, EACCES, dst exists, etc). Fall
    // through to a plain copy — slower but correct. We deliberately
    // drop COPYFILE_FICLONE on the fallback because the only reason
    // to retry is when the reflink path didn't work.
    copyFileSync(src, dst);
    return;
  }
  copyFileSync(src, dst, fsConstants.COPYFILE_FICLONE);
}
