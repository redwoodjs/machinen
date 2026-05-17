// Pure utilities used across the boot/attach/snapshot/restore/fork
// surfaces. No VM lifecycle state lives here — everything in this
// module is either a constant, a one-shot validator, or a stateless
// command/string builder.

import { randomBytes } from "node:crypto";
import { closeSync, existsSync, openSync, writeSync } from "node:fs";
import { createRequire } from "node:module";
import { arch as osArch, platform as osPlatform, totalmem } from "node:os";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import debugLib from "debug";

import { BootError } from "../errors.ts";
import type { VsockExecOptions } from "../exec.ts";
import type { OnLog } from "../log.ts";
import type { VmHandle, WriteFileOptions } from "../vm-handle.ts";

const debug = debugLib("machinen:boot");
const require_ = createRequire(import.meta.url);

// Default size for the auto-allocated snapshot scratch (#TBD). Sparse,
// so the file's real disk usage stays at zero until the guest dumps
// memory pages into it via /sbin/machinen-dump. 8 GiB is enough headroom
// for a CRIU dump of typical dev workloads (Node, claude-code, a few
// shells) without bumping into the cap; callers with bigger workloads
// can pass an explicit `snapshot: '<path>'` and pre-allocate it themselves.
export const SNAP_SCRATCH_BYTES = 8 * 1024 * 1024 * 1024;

export function allocateSparseFile(path: string, sizeBytes: number): void {
  const fd = openSync(path, "w");
  try {
    const buf = Buffer.alloc(1);
    writeSync(fd, buf, 0, 1, sizeBytes - 1);
  } finally {
    closeSync(fd);
  }
}

// #263 phase A: pick the guest RAM ceiling (in MiB). This is a VM
// layout limit, not the host memory the VM is using right now. Keep
// the default modest: 4 GiB is enough for the normal dev loop, while
// smaller hosts still get at most half their RAM before the 512 MiB
// floor kicks in. Callers that need more can pass `memory` explicitly.
//
// The ceiling is approximately free until touched (see
// `packages/microvm/docs/memory.md`), but raising it still increases
// guest metadata and the possible high-water mark, so the default
// should not scale with large developer machines.
const MEMORY_FLOOR_MIB = 512;
const MEMORY_DEFAULT_CEILING_MIB = 4096;

export function autoSizeMemoryMib(hostBytes: number = totalmem()): number {
  const hostMib = Math.floor(hostBytes / (1024 * 1024));
  const hostAwareCeiling = Math.floor(hostMib / 2);
  return Math.max(MEMORY_FLOOR_MIB, Math.min(hostAwareCeiling, MEMORY_DEFAULT_CEILING_MIB));
}

export function validateMemoryMib(mib: number): number {
  if (!Number.isInteger(mib) || mib <= 0) {
    throw new BootError(
      "BOOT_MEMORY_INVALID",
      `boot: memory must be a positive integer (MiB, no unit suffix), got ${mib}`,
    );
  }
  if (mib < MEMORY_FLOOR_MIB) {
    throw new BootError(
      "BOOT_MEMORY_INVALID",
      `boot: memory must be at least ${MEMORY_FLOOR_MIB} MiB (got ${mib}); the kernel + ` +
        `initramfs need headroom to boot.`,
    );
  }
  return mib;
}

/**
 * Locate the VMM binary using the same lookup order as `@machinen/cli`:
 *   1. `MACHINEN_VMM` env var (dev-mode override)
 *   2. `require.resolve("@machinen/native-<arch>-<os>")` → `binary` export
 *
 * `@machinen/native-{arm64-darwin,arm64-linux,x64-linux}` is the
 * consolidated host-tool package — it carries the VMM, gvproxy,
 * guest ELFs, mke2fs, and mksquashfs. Callers can pass an explicit
 * `binary` to `boot()` to bypass this.
 *
 * @throws {BootError} BOOT_VMM_MISSING | BOOT_VMM_PACKAGE_BROKEN
 */
export function resolveVmmBinary(): string {
  const envOverride = process.env.MACHINEN_VMM;
  if (envOverride) {
    const abs = resolve(envOverride);
    if (!existsSync(abs)) {
      throw new BootError(
        "BOOT_VMM_MISSING",
        `MACHINEN_VMM is set to ${envOverride}, but that file does not exist.`,
      );
    }
    return abs;
  }

  const key = `${osArch()}-${osPlatform()}`;
  const pkgName = `@machinen/native-${key}`;
  try {
    const mod = require_(pkgName) as { binary: string };
    if (!mod.binary || !existsSync(mod.binary)) {
      throw new BootError(
        "BOOT_VMM_PACKAGE_BROKEN",
        `${pkgName} is installed but its VMM binary is missing at ${mod.binary}.`,
      );
    }
    return mod.binary;
  } catch (err) {
    if (err instanceof BootError) {
      throw err;
    }
    throw new BootError(
      "BOOT_VMM_MISSING",
      `No VMM binary found for ${key}.\n` +
        `  Expected package: ${pkgName}\n` +
        `  Install: npm i ${pkgName}   (or npm i -g @machinen/cli)`,
      { cause: err },
    );
  }
}

/**
 * Parse the UDS path out of a `MACHINEN_VSOCK` spec. The spec may be a
 * single `<direction>:<port>:<uds-path>` entry or a comma-joined list
 * of them (`in:1978:/a,in:1974:/b,out:1970:/c`). For attach/exec we want
 * the FIRST `in:` entry's path — that's the exec-agent UDS the runtime
 * just allocated (or, when the caller set MACHINEN_VSOCK explicitly,
 * the entry they put first). Returns undefined on unrecognized shapes
 * so the handle can throw a clear error if `.exec()` ends up called on it.
 */
export function parseVsockUdsPath(spec: string): string | undefined {
  for (const entry of spec.split(",")) {
    const match = entry.match(/^[^:]+:\d+:(.+)$/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

// The user-facing mount root. Guest paths must live under this prefix
// so mounts can never shadow the base rootfs or kernel filesystems.
const MOUNT_ROOT = "/mnt/";

export function normalizeMountGuest(guest: string): string {
  return guest.replace(/\/+$/, "");
}

export function validateGuestCwd(cwd: string): void {
  if (!cwd || !cwd.startsWith("/")) {
    throw new BootError("BOOT_CWD_INVALID", `guestCwd must be an absolute path (got '${cwd}')`);
  }
  if (cwd.includes("\0")) {
    throw new BootError("BOOT_CWD_INVALID", "guestCwd must not contain NUL bytes");
  }
}

export function validateMountGuest(guest: string): void {
  if (!guest || !guest.startsWith("/")) {
    throw new BootError("BOOT_MOUNT_INVALID", `mount guest path must be absolute: ${guest}`);
  }
  const trimmed = normalizeMountGuest(guest);
  if (!trimmed.startsWith(MOUNT_ROOT) || trimmed === MOUNT_ROOT.replace(/\/$/, "")) {
    throw new BootError(
      "BOOT_MOUNT_INVALID",
      `mount guest path must live under ${MOUNT_ROOT} (got ${guest}) — ` +
        `pick a sub-path like ${MOUNT_ROOT}app`,
    );
  }
}

/**
 * Single-quote a string for safe interpolation inside a shell single-
 * quoted literal. Embedded single quotes get the standard
 * `'\''` close-escape-reopen treatment.
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the shell pipeline that `vm.writeFile()` ships through the
 * exec-agent. Stays single-line so it works against the legacy EXEC
 * opcode too (no need for the EXEC2 multi-line frame, which only newer
 * agents understand).
 *
 * Encoding: contents go over the wire as base64 inside an `echo … |
 * base64 -d` pipe, so any byte sequence (binary, newlines, quotes) is
 * safe. `mkdir -p` runs first when `recursive` (the default).
 *
 * Returns a single cmd string. For payloads that would exceed Linux's
 * `MAX_ARG_STRLEN` (128 KB per argv element) once shell-wrapped, use
 * `buildWriteFileCmds` instead — `vm.writeFile()` does.
 */
export function buildWriteFileCmd(
  guestPath: string,
  contents: Buffer | string,
  opts: WriteFileOptions = {},
): string {
  const buf = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  const b64 = buf.toString("base64");
  const path = shellQuote(guestPath);
  const redir = opts.append ? ">>" : ">";
  const parts: string[] = [];
  if (opts.recursive ?? true) {
    parts.push(`mkdir -p -- "$(dirname -- ${path})"`);
  }
  // base64 has no shell metacharacters, but we still single-quote it
  // so the printf carries it verbatim regardless of length.
  parts.push(`printf %s ${shellQuote(b64)} | base64 -d ${redir} ${path}`);
  if (opts.mode !== undefined) {
    if (!Number.isInteger(opts.mode) || opts.mode < 0 || opts.mode > 0o7777) {
      throw new RangeError(`writeFile: mode out of range (got ${opts.mode})`);
    }
    parts.push(`chmod ${opts.mode.toString(8).padStart(3, "0")} ${path}`);
  }
  return parts.join(" && ");
}

// Linux's `MAX_ARG_STRLEN` caps a single argv element at 32 pages
// (128 KB on 4 KB-page arches). The exec-agent runs cmds via
// `execve("/bin/sh", {"sh","-c",cmd,null}, ...)`, so the whole shell
// pipeline is one argv element. Going over -> execve returns E2BIG ->
// the agent's child falls through to `_exit(127)` and `vm.exec`
// surfaces it as "vm.exec failed (code 127)". 64 KB per chunk leaves
// generous headroom for the surrounding `printf %s '...' >> /tmp/X`
// wrapper while still letting a typical small payload finish in one cmd.
const WRITE_FILE_B64_CHUNK_BYTES = 64 * 1024;

/**
 * Plan the cmd sequence `vm.writeFile()` issues for `contents`.
 * Small payloads (base64 ≤ `WRITE_FILE_B64_CHUNK_BYTES`) collapse to a
 * single cmd identical to `buildWriteFileCmd`'s output. Larger payloads
 * stage the base64 to /tmp in append-chunks and then decode once at the
 * end, so no individual cmd line approaches `MAX_ARG_STRLEN`.
 */
export function buildWriteFileCmds(
  guestPath: string,
  contents: Buffer | string,
  opts: WriteFileOptions = {},
): string[] {
  const buf = typeof contents === "string" ? Buffer.from(contents, "utf8") : contents;
  const b64 = buf.toString("base64");
  if (b64.length <= WRITE_FILE_B64_CHUNK_BYTES) {
    return [buildWriteFileCmd(guestPath, contents, opts)];
  }
  if (opts.mode !== undefined) {
    if (!Number.isInteger(opts.mode) || opts.mode < 0 || opts.mode > 0o7777) {
      throw new RangeError(`writeFile: mode out of range (got ${opts.mode})`);
    }
  }
  const path = shellQuote(guestPath);
  const redir = opts.append ? ">>" : ">";
  // Each cmd in the sequence runs in its own `sh -c`, so `$$` would
  // expand to a different PID per invocation and the chunks would
  // scatter across files. Bake a host-generated suffix into every cmd
  // so they all hit the same staging file.
  const stage = `/tmp/.machinen-wf.${randomBytes(8).toString("hex")}`;
  const cmds: string[] = [];
  const setupParts: string[] = [];
  if (opts.recursive ?? true) {
    setupParts.push(`mkdir -p -- "$(dirname -- ${path})"`);
  }
  setupParts.push(`: > ${stage}`);
  cmds.push(setupParts.join(" && "));
  for (let i = 0; i < b64.length; i += WRITE_FILE_B64_CHUNK_BYTES) {
    const chunk = b64.slice(i, i + WRITE_FILE_B64_CHUNK_BYTES);
    cmds.push(`printf %s ${shellQuote(chunk)} >> ${stage}`);
  }
  const finalParts: string[] = [`base64 -d < ${stage} ${redir} ${path}`, `rm -f ${stage}`];
  if (opts.mode !== undefined) {
    finalParts.push(`chmod ${opts.mode.toString(8).padStart(3, "0")} ${path}`);
  }
  cmds.push(finalParts.join(" && "));
  return cmds;
}

/**
 * Layer an `onLog` over per-call `onStdout` / `onStderr`: the caller's
 * narrow callbacks still fire if they set them, and the handle-level
 * `onLog` receives a tagged event for every chunk. See #83.
 */
export function teeOnLog(
  cmd: string,
  execOpts: VsockExecOptions | undefined,
  onLog: OnLog | undefined,
): VsockExecOptions | undefined {
  if (!onLog) {
    return execOpts;
  }
  const userOnStdout = execOpts?.onStdout;
  const userOnStderr = execOpts?.onStderr;
  return {
    ...execOpts,
    onStdout(chunk) {
      onLog({ source: "exec-stdout", cmd, chunk });
      userOnStdout?.(chunk);
    },
    onStderr(chunk) {
      onLog({ source: "exec-stderr", cmd, chunk });
      userOnStderr?.(chunk);
    },
  };
}

/**
 * Cap on bytes retained per stream by `collect()`. Each VM session keeps
 * the *last* this-many bytes of stdout/stderr; older bytes are dropped.
 * The kernel boot console fits well under this, snapshot debugging only
 * uses the last ~2 KB, and a multi-hour idle VM no longer accumulates
 * gigabytes of console chatter in the supervisor's heap (issue #150).
 */
export const CONSOLE_TAIL_BYTES = 1_048_576;

export function collect(stream: Readable, capBytes: number = CONSOLE_TAIL_BYTES): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    stream.on("data", (c: Buffer) => {
      chunks.push(c);
      totalBytes += c.length;
      // Drop whole chunks from the head while doing so leaves at least
      // `capBytes` retained. This keeps the ring within [cap, cap +
      // size-of-head-chunk] in steady state, which for line-buffered
      // VMM stderr is comfortably bounded.
      while (chunks.length > 1 && totalBytes - chunks[0].length >= capBytes) {
        totalBytes -= chunks.shift()!.length;
      }
    });
    const finish = () => {
      let merged = Buffer.concat(chunks);
      // If a single oversized chunk pushed us above cap (or we ended
      // up holding more than cap because no head was safe to drop),
      // tail-slice on the way out so the resolved string honors the cap.
      if (merged.length > capBytes) {
        merged = merged.subarray(merged.length - capBytes);
      }
      done(merged.toString("utf8"));
    };
    stream.on("end", finish);
    stream.on("close", finish);
    stream.on("error", fail);
  });
}

/**
 * Build the kernel hostname we set on the guest. Always includes the
 * host VMM pid so each running VM has a unique label, even when the
 * caller didn't pass a name. Format:
 *   - named:    `<name>-pid-<host_pid>`
 *   - nameless: `vm-pid-<host_pid>`
 *
 * Sanitizes the name component (replaces anything outside the POSIX
 * hostname charset with `-`) so an auto-name like `<src>~<pid>` or
 * `<src>/<pid>` becomes a valid hostname instead of being rejected.
 */
export function buildGuestHostname(pid: number, name?: string): string {
  const tag = `pid-${pid}`;
  if (!name) {
    return `vm-${tag}`;
  }
  // RFC 952/1123: letters, digits, hyphen. Map everything else to `-`,
  // collapse runs of `-`, and trim leading/trailing `-`.
  const safe = name
    .replace(/[^A-Za-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe.length > 0 ? `${safe}-${tag}` : `vm-${tag}`;
}

/**
 * Set the guest's kernel hostname over vsock-exec. Fire-and-forget:
 * any failure is logged at debug level and swallowed — a wrong prompt
 * label is strictly cosmetic and must never break a boot/restore.
 *
 * Note for callers chasing prompt updates: bash's `\h` reads
 * `gethostname()` once at shell startup and caches it. Restored
 * (CRIU) shells and shells already running before this call won't
 * pick up the change in their prompt — the kernel value updates,
 * but the live shell needs `exec bash` (or a new shell via
 * `machinen attach`) to re-read.
 */
export async function setGuestHostname(vm: VmHandle, hostname: string): Promise<void> {
  if (
    hostname.length === 0 ||
    hostname.includes("'") ||
    hostname.includes("\n") ||
    hostname.includes("\0")
  ) {
    debug("setGuestHostname: refusing unsafe hostname %j", hostname);
    return;
  }
  try {
    // execRaw doesn't throw on non-zero exit; we just don't care
    // either way. 5s connectTimeout covers slow boot agent bring-up
    // without dragging caller latency.
    await vm.execRaw(`hostname '${hostname}' 2>/dev/null || true`, {
      connectTimeoutMs: 5_000,
      execTimeoutMs: 5_000,
    });
    debug("setGuestHostname: set pid=%d hostname=%s", vm.pid, hostname);
  } catch (err) {
    debug(
      "setGuestHostname: failed pid=%d hostname=%s err=%s",
      vm.pid,
      hostname,
      err instanceof Error ? err.message : String(err),
    );
  }
}
