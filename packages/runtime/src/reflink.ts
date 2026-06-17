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
// Strategy:
//   - Darwin: spawnSync `/bin/cp -c src dst`. Process spawn is ~5 ms,
//     dwarfed by the saving. If it fails (e.g. cross-volume — clonefile
//     is volume-local), fall back to plain copyFileSync without the
//     reflink flag (correctness over speed for the rare cross-volume
//     case).
//   - Everywhere else: try COPYFILE_FICLONE_FORCE first so the caller
//     can tell true CoW from fallback copy, then fall back explicitly.

import { spawnSync } from "node:child_process";
import { constants as fsConstants, copyFileSync, rmSync, statSync } from "node:fs";
import { platform } from "node:os";
import { basename } from "node:path";
import debugLib from "debug";

const debug = debugLib("machinen:reflink");

interface ReflinkCopyResult {
  mode: "cow" | "copy";
  primitive: "darwin-cp-c" | "node-ficlone-force" | "linux-cp-sparse" | "node-copy";
  fallbackReason?: string;
}

/**
 * Reflink-clone `src` to `dst`. The destination must NOT exist (same
 * contract as `clonefile(2)`). Falls back to a regular byte copy on
 * filesystems that don't support reflinks.
 */
export function reflinkCopy(src: string, dst: string): ReflinkCopyResult {
  const start = Date.now();
  const result = platform() === "darwin" ? reflinkCopyDarwin(src, dst) : reflinkCopyNode(src, dst);
  logRootdiskReflinkCopy(src, dst, result, Date.now() - start);
  return result;
}

function reflinkCopyDarwin(src: string, dst: string): ReflinkCopyResult {
  const res = spawnSync("/bin/cp", ["-c", src, dst], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (res.status === 0) {
    return { mode: "cow", primitive: "darwin-cp-c" };
  }
  // `cp -c` failed (cross-volume, EACCES, dst exists, etc). Fall
  // through to a plain copy — slower but correct. We deliberately
  // drop COPYFILE_FICLONE on the fallback because the only reason
  // to retry is when the reflink path didn't work.
  const fallbackReason = darwinCpFallbackReason(res);
  copyFileSync(src, dst);
  return { mode: "copy", primitive: "node-copy", fallbackReason };
}

function reflinkCopyNode(src: string, dst: string): ReflinkCopyResult {
  try {
    copyFileSync(src, dst, fsConstants.COPYFILE_FICLONE_FORCE);
    return { mode: "cow", primitive: "node-ficlone-force" };
  } catch (err) {
    const fallbackReason = copyErrorFallbackReason(err);
    rmSync(dst, { force: true });
    if (platform() === "linux" && sparseCopyLinux(src, dst)) {
      return { mode: "copy", primitive: "linux-cp-sparse", fallbackReason };
    }
    rmSync(dst, { force: true });
    copyFileSync(src, dst);
    return {
      mode: "copy",
      primitive: "node-copy",
      fallbackReason,
    };
  }
}

function sparseCopyLinux(src: string, dst: string): boolean {
  const res = spawnSync("cp", ["--sparse=always", "--reflink=never", src, dst], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (res.status === 0) {
    return true;
  }
  debug(
    "linux sparse cp failed src=%s dst=%s status=%s stderr=%s",
    src,
    dst,
    res.status,
    res.stderr?.toString().slice(0, 200) ?? "",
  );
  return false;
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

function darwinCpFallbackReason(res: ReturnType<typeof spawnSync>): string {
  if (res.error) {
    return `cp-c-error-${sanitizeReason(res.error.message)}`;
  }
  if (res.signal) {
    return `cp-c-signal-${sanitizeReason(res.signal)}`;
  }
  return `cp-c-status-${res.status ?? "unknown"}`;
}

function copyErrorFallbackReason(err: unknown): string {
  const code = typeof err === "object" && err && "code" in err ? String(err.code) : "error";
  const message = err instanceof Error ? err.message : String(err);
  return `${sanitizeReason(code)}-${sanitizeReason(message)}`.slice(0, 120);
}

function sanitizeReason(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}
