// @machinen/runtime — TypeScript surface for spawning microVMs.
//
// The Zig VMM is a separate binary (today: the test binary produced
// by `zig build test` in packages/microvm). This package wraps it so
// application code can say:
//
//   const vm = await spawn({ binary, env: { MACHINEN_BOOT_TEST: "1" } });
//   vm.stdin.write("process.version\n.exit\n");
//   const out = await vm.output();
//   await vm.wait();
//
// That's it for v0.1 — no virtio, no spawn-from-snapshot, no
// multiplexing. Just a child-process wrapper with an async-friendly
// shape. See issues #46, #50, #51 for the bigger pieces this depends
// on or unblocks.

import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Readable, Writable } from "node:stream";

export class SpawnError extends Error {}

export interface SpawnOptions {
  /** Absolute or cwd-relative path to the built VMM binary. */
  binary: string;
  /** Extra env vars passed to the guest wrapper (not into the guest itself). */
  env?: Record<string, string>;
  /** Working directory for the VMM (for finding fixture files). */
  cwd?: string;
  /** Extra argv for the VMM. */
  args?: string[];
  /**
   * Milliseconds to wait in `wait()` before giving up and rejecting.
   * Defaults to 60s. Pass `null` to wait forever.
   */
  timeoutMs?: number | null;
}

export interface VmHandle {
  readonly pid: number;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;

  /** Resolves when the VM process exits. Rejects on timeout. */
  wait(): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;

  /** Send SIGKILL to the VM. Resolves once it's really gone. */
  kill(): Promise<void>;

  /** Buffer stdout until the process exits; return it as a UTF-8 string. */
  output(): Promise<string>;

  /** Same as `output()` but for stderr (where guest console lands). */
  errorOutput(): Promise<string>;
}

export async function spawn(opts: SpawnOptions): Promise<VmHandle> {
  const binary = resolve(opts.cwd ?? process.cwd(), opts.binary);
  if (!existsSync(binary)) {
    throw new SpawnError(`VMM binary not found at ${binary}`);
  }

  const child = nodeSpawn(binary, opts.args ?? [], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  const timeoutMs = opts.timeoutMs === undefined ? 60_000 : opts.timeoutMs;

  // Start collecting stdout/stderr eagerly. Doing it lazily on the
  // first call to `.output()` / `.errorOutput()` loses data: the
  // streams can flush + close before the listener attaches, and more
  // importantly, the child backpressures if no one is reading (the
  // PL011 echo path writes a lot of bytes during kernel boot, enough
  // to fill a pipe buffer if nothing's draining it).
  const outputCollector = collect(child.stdout);
  const errorCollector = collect(child.stderr);

  const handle: VmHandle = {
    pid: child.pid ?? -1,
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,

    async wait() {
      const settled = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
      const race =
        timeoutMs === null
          ? settled
          : Promise.race([
              settled,
              new Promise<never>((_, reject) => {
                setTimeout(
                  () => reject(new SpawnError(`VMM did not exit within ${timeoutMs}ms`)),
                  timeoutMs,
                ).unref();
              }),
            ]);
      const [code, signal] = await race;
      return { code, signal };
    },

    async kill() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill("SIGKILL");
      await once(child, "exit");
    },

    output: () => outputCollector,
    errorOutput: () => errorCollector,
  };

  return handle;
}

function collect(stream: Readable): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    stream.on("close", () => done(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", fail);
  });
}
