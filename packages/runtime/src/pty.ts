// PTY-backed boot — #51 M1.5.
//
// `bootPty()` is the terminal-aware sibling of `boot()`. Same handle
// shape (Sandboxes.add takes either one) plus a `.resize(cols, rows)`
// method that routes through to the master fd, so SIGWINCH on the
// supervisor's terminal can shrink/grow the attached sandbox's view.
//
// On the inside it's `@homebridge/node-pty-prebuilt-multiarch`: an
// API-compatible fork of node-pty that ships prebuilt binaries for
// darwin/linux (arm64 + x64) without requiring python/node-gyp at
// install time. The only gotcha is that on macOS the companion
// `spawn-helper` binary sometimes lands with its exec bit stripped
// after a pnpm install; `ensureSpawnHelper` fixes that up lazily.

import { chmodSync, constants as fsConstants, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { createRequire } from "node:module";

const PTY_MODULE = "@homebridge/node-pty-prebuilt-multiarch";

// The prebuilt-multiarch fork publishes CommonJS only; import via
// createRequire so this file stays ESM like the rest of the package.
const require_ = createRequire(import.meta.url);
type NodePty = typeof import("@homebridge/node-pty-prebuilt-multiarch");
let ptyMod: NodePty | null = null;
function loadPty(): NodePty {
  if (ptyMod) {
    return ptyMod;
  }
  ensureSpawnHelper();
  ptyMod = require_(PTY_MODULE) as NodePty;
  return ptyMod;
}

/**
 * Walk the pty package's prebuilds dir and make sure the spawn-helper
 * is executable. pnpm sometimes unpacks prebuilt binaries without the
 * exec bit; posix_spawnp then fails with a cryptic "posix_spawnp
 * failed." This is a one-shot no-op on healthy installs.
 */
function ensureSpawnHelper(): void {
  try {
    const resolved = require_.resolve(PTY_MODULE);
    const pkgDir = findPackageDir(resolved);
    if (!pkgDir) {
      return;
    }
    const prebuilds = join(pkgDir, "prebuilds");
    const platforms = readdirSync(prebuilds, { withFileTypes: true });
    for (const p of platforms) {
      if (!p.isDirectory()) {
        continue;
      }
      const helper = join(prebuilds, p.name, "spawn-helper");
      try {
        const s = statSync(helper);
        if ((s.mode & fsConstants.S_IXUSR) === 0) {
          chmodSync(helper, 0o755);
        }
      } catch {
        // Missing helpers for other platforms are fine.
      }
    }
  } catch {
    // Best-effort only. If we can't find the package dir, fall through
    // and let the require() error bubble up with a real stack.
  }
}

function findPackageDir(entry: string): string | null {
  let dir = dirname(entry);
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = statSync(join(dir, "package.json"));
      if (pkg.isFile()) {
        return dir;
      }
    } catch {
      // keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

export interface PtyBootOptions {
  /** Absolute or cwd-relative path to the binary to fork. */
  binary: string;
  /** Extra env. Merged over process.env. */
  env?: Record<string, string>;
  cwd?: string;
  args?: string[];
  /** Initial terminal size. Defaults to 80x24. */
  cols?: number;
  rows?: number;
  /** TERM value. Default `xterm-256color` — the CC banner wants colors. */
  name?: string;
}

export interface PtyVmHandle {
  readonly pid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  /** Same stream as `stdout`. A pty merges stdout + stderr in the kernel. */
  readonly stderr: Readable;
  /** Tell the kernel the terminal is now `cols`x`rows`. Triggers SIGWINCH in the child. */
  resize(cols: number, rows: number): void;
  wait(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill(): Promise<void>;
  output(): Promise<string>;
  /** Alias of output() — a pty gives us one merged stream. */
  errorOutput(): Promise<string>;
}

/**
 * Fork `binary` under a new pty pair. The returned handle is wire-
 * compatible with `VmHandle` from index.ts so the existing Sandboxes
 * registry can hold it.
 */
export function bootPty(opts: PtyBootOptions): PtyVmHandle {
  const pty = loadPty();
  const child = pty.spawn(opts.binary, opts.args ?? [], {
    name: opts.name ?? "xterm-256color",
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    cwd: opts.cwd ?? process.cwd(),
    env: { ...(process.env as Record<string, string>), ...opts.env },
  });

  // Wrap the pty data stream as a Node Readable so it works with
  // Sandboxes.add (which listens on `.on('data', ...)`). The pty
  // emits strings by default; we forward them as Buffers — matching
  // what a child_process.spawn'd child gives us.
  //
  // Collection happens at the node-pty callback layer (not via a
  // PassThrough 'data' listener), so the PassThrough stays in paused
  // mode until the real consumer (Sandboxes / Supervisor / caller)
  // attaches. Otherwise an internal listener would drain data before
  // the consumer subscribed.
  const collected: Buffer[] = [];
  const out = new PassThrough();
  const dataUnsub = child.onData((chunk) => {
    const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    collected.push(buf);
    out.write(buf);
  });

  // stdin side: Writable adapter that pipes into pty.write(). Bytes
  // go through the kernel's tty line discipline on the way to the
  // child — i.e. Ctrl-C generates SIGINT just like in a real terminal.
  const stdin = new PassThrough();
  stdin.on("data", (buf: Buffer) => child.write(buf.toString("utf8")));

  const exitP = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.onExit((ev) => {
      dataUnsub.dispose();
      out.end();
      done({
        code: ev.exitCode ?? null,
        signal: ev.signal ? (("SIG" + ev.signal) as NodeJS.Signals) : null,
      });
    });
  });

  return {
    pid: child.pid,
    stdin,
    stdout: out,
    stderr: out,
    resize(cols, rows) {
      child.resize(cols, rows);
    },
    wait: () => exitP,
    async kill() {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      await exitP;
    },
    async output() {
      await exitP;
      return Buffer.concat(collected).toString("utf8");
    },
    async errorOutput() {
      await exitP;
      return Buffer.concat(collected).toString("utf8");
    },
  };
}
