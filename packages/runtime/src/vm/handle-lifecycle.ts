import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";

import { BootError } from "../errors.ts";
import type { VmHandle } from "../vm-handle.ts";
import type { BootOptions } from "./boot.ts";

export function validateBootStdio(opts: BootOptions): void {
  if (opts.stdio === undefined || opts.stdio === "pipe" || opts.stdio === "inherit") {
    if (opts.stdio === "inherit" && opts.detached) {
      throw new BootError(
        "BOOT_STDIO_DETACHED",
        'boot({ stdio: "inherit" }) cannot be combined with detached: true',
      );
    }
    return;
  }
  throw new BootError("BOOT_STDIO_INVALID", 'boot stdio must be "pipe" or "inherit" when provided');
}

export function makeWait(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number | null,
): VmHandle["wait"] {
  return async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return { code: child.exitCode, signal: child.signalCode };
    }
    const settled = once(child, "exit") as Promise<[number | null, NodeJS.Signals | null]>;
    const race =
      timeoutMs === null
        ? settled
        : Promise.race([
            settled,
            new Promise<never>((_, reject) => {
              setTimeout(
                () =>
                  reject(new BootError("BOOT_TIMEOUT", `VMM did not exit within ${timeoutMs}ms`)),
                timeoutMs,
              ).unref();
            }),
          ]);
    const [code, signal] = await race;
    return { code, signal };
  };
}

export function makeKill(child: ChildProcessWithoutNullStreams): VmHandle["kill"] {
  return async () => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    child.kill("SIGTERM");
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    const escalate = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
    }, 2_000);
    escalate.unref();
    try {
      await once(child, "exit");
    } finally {
      clearTimeout(escalate);
    }
  };
}

interface InheritedStdioCleanup {
  cleanup(): void;
}

export function installInheritedStdio(
  child: ChildProcessWithoutNullStreams,
): InheritedStdioCleanup {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const stderr = process.stderr;
  const wasRaw = stdin.isTTY && stdin.isRaw === true;
  let cleaned = false;

  if (stdin.isTTY) {
    stdin.setRawMode(true);
    stdin.resume();
  }
  stdin.pipe(child.stdin);
  child.stdout.pipe(stdout);
  child.stderr.pipe(stderr);

  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    stdin.unpipe(child.stdin);
    child.stdout.unpipe(stdout);
    child.stderr.unpipe(stderr);
    if (stdin.isTTY && !wasRaw) {
      try {
        stdin.setRawMode(false);
      } catch {}
    }
  };

  child.once("exit", cleanup);
  child.once("error", cleanup);
  return { cleanup };
}

export function withInheritedStdioCleanup(
  handle: VmHandle,
  inherited: InheritedStdioCleanup,
): VmHandle {
  return {
    ...handle,
    async wait() {
      try {
        return await handle.wait();
      } finally {
        inherited.cleanup();
      }
    },
    async kill() {
      try {
        return await handle.kill();
      } finally {
        inherited.cleanup();
      }
    },
    async detach() {
      try {
        return await handle.detach();
      } finally {
        inherited.cleanup();
      }
    },
  };
}
