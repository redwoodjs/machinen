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
// TypeScript keeps the public wrapper and debug logging; the native
// runtime helper owns platform-specific CoW/sparse-copy behavior.

import { statSync } from "node:fs";
import { basename } from "node:path";
import debugLib from "debug";
import { reflinkCopyNative, type NativeReflinkCopyResult } from "./native/reflink.ts";

const debug = debugLib("machinen:reflink");

type ReflinkCopyResult = NativeReflinkCopyResult;

/**
 * Reflink-clone `src` to `dst`. The destination must NOT exist (same
 * contract as `clonefile(2)`). Falls back to a regular byte copy on
 * filesystems that don't support reflinks.
 */
export function reflinkCopy(src: string, dst: string): ReflinkCopyResult {
  const start = Date.now();
  const result = reflinkCopyNative(src, dst);
  logRootdiskReflinkCopy(src, dst, result, Date.now() - start);
  return result;
}

function logRootdiskReflinkCopy(
  src: string,
  dst: string,
  result: ReflinkCopyResult,
  elapsedMs: number,
): void {
  const name = rootdiskCopyName(dst);
  if (!name) {
    return;
  }
  debug(
    "rootdisk-materialize event=reflink-copy name=%s mode=%s primitive=%s fallbackReason=%s bytes=%d elapsedMs=%d src=%s dst=%s",
    name,
    result.mode,
    result.primitive,
    result.fallbackReason ?? "none",
    copyBytes(src, dst),
    elapsedMs,
    src,
    dst,
  );
}

function rootdiskCopyName(dst: string): string | undefined {
  const name = basename(dst);
  if (name.startsWith("machinen-rootdisk-restore-")) {
    return "restore-reflink";
  }
  if (name.startsWith("machinen-rootdisk-")) {
    return "reflink";
  }
  return undefined;
}

function copyBytes(src: string, dst: string): number {
  try {
    return statSync(dst).size;
  } catch {}
  try {
    return statSync(src).size;
  } catch {}
  return 0;
}
