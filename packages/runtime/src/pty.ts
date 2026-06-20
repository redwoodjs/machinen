// PTY-backed boot — #51 M1.5.
//
// `bootPty()` is the terminal-aware sibling of `boot()`. Same handle
// shape (Sandboxes.add takes either one) plus a `.resize(cols, rows)`
// method that routes through to the native PTY shim, so SIGWINCH on
// the supervisor's terminal can shrink/grow the attached sandbox's view.

import { spawn } from "node:child_process";
import { PassThrough, type Readable, type Writable } from "node:stream";
import { resolvePtyShim } from "./native/pty.ts";

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
  const shim = resolvePtyShim();
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const term = opts.name ?? "xterm-256color";
  const child = spawn(
    shim,
    [
      "--cols",
      String(cols),
      "--rows",
      String(rows),
      "--term",
      term,
      "--",
      opts.binary,
      ...(opts.args ?? []),
    ],
    {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...(process.env as Record<string, string>), ...opts.env },
      stdio: ["pipe", "pipe", "ignore", "pipe"],
    },
  );
  const control = child.stdio[3] as Writable | undefined;

  const exitP = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.on("error", () => {
      done({ code: null, signal: null });
    });
    child.on("exit", (code, signal) => {
      done({ code, signal });
    });
  });

  // Wrap the pty data stream as a Node Readable so it works with
  // Sandboxes.add (which listens on `.on('data', ...)`). Collection
  // happens at the native shim stdout layer, so the PassThrough stays
  // in paused mode until the real consumer attaches.
  const collected: Buffer[] = [];
  const out = new PassThrough();
  child.stdout.on("data", (chunk: Buffer) => {
    collected.push(chunk);
    out.write(chunk);
  });
  child.stdout.on("close", () => out.end());

  // stdin side: Writable adapter that pipes into the shim. Bytes go
  // through the kernel's tty line discipline on the way to the child
  // — i.e. Ctrl-C generates SIGINT just like in a real terminal.
  const stdin = new PassThrough();
  stdin.on("data", (buf: Buffer) => {
    child.stdin.write(buf);
  });
  stdin.on("end", () => {
    child.stdin.end();
  });

  exitP.then(
    () => out.end(),
    () => out.end(),
  );

  return {
    pid: child.pid ?? 0,
    stdin,
    stdout: out,
    stderr: out,
    resize(nextCols, nextRows) {
      control?.write(`R ${nextCols} ${nextRows}\n`);
    },
    wait: () => exitP,
    async kill() {
      control?.write("K\n");
      child.stdin.end();
      const force = setTimeout(() => child.kill("SIGKILL"), 500);
      force.unref();
      await exitP;
      clearTimeout(force);
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
