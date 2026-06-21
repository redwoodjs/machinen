import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";

import { ExecError } from "../errors.ts";
import type { VmHandle } from "../vm-handle.ts";
import { CONSOLE_TAIL_BYTES } from "./helpers.ts";

type DetachedReadinessOutcome =
  | { kind: "ready" }
  | { kind: "exit"; lastError?: unknown }
  | { kind: "timeout"; lastError?: unknown };

export async function runVsockWithBootDiagnostics<T>(
  child: ChildProcessWithoutNullStreams,
  errorCollector: Promise<string>,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ExecError) {
      await waitBrieflyForExit(child);
      if (child.exitCode !== null || child.signalCode !== null) {
        const stderrTail = (await errorCollector).slice(-CONSOLE_TAIL_BYTES);
        if (stderrTail) {
          throw new ExecError(err.code, `${err.message}\n${bootStderrDiagnostic(stderrTail)}`, {
            cause: err,
            retryable: err.retryable,
          });
        }
      }
    }
    throw err;
  }
}

async function waitBrieflyForExit(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await Promise.race([once(child, "exit"), delay(25)]);
}

export async function waitForDetachedExecAgent(
  args: {
    child: ChildProcessWithoutNullStreams;
    handle: VmHandle;
  },
  timeoutMs: number,
): Promise<DetachedReadinessOutcome> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (args.child.exitCode !== null || args.child.signalCode !== null) {
      return { kind: "exit", lastError };
    }
    const remaining = Math.max(1, deadline - Date.now());
    try {
      await args.handle.execRaw("true", {
        connectTimeoutMs: Math.min(remaining, 250),
        execTimeoutMs: Math.min(remaining, 1_000),
      });
      return { kind: "ready" };
    } catch (err) {
      lastError = err;
      if (args.child.exitCode !== null || args.child.signalCode !== null) {
        return { kind: "exit", lastError };
      }
      await delay(Math.min(Math.max(1, deadline - Date.now()), 50));
    }
  }
  return { kind: "timeout", lastError };
}

export function bootStderrTail(chunks: Buffer[]): string {
  return Buffer.concat(chunks).slice(-CONSOLE_TAIL_BYTES).toString("utf8");
}

export function bootReadinessFailureMessage(
  prefix: string,
  bootLogPath: string,
  stderrTail: string,
): string {
  return (
    `${prefix} ${classifyBootStderr(stderrTail)}. Boot console snapshot at ${bootLogPath}.` +
    (stderrTail ? `\n${bootStderrDiagnostic(stderrTail)}` : "")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

function bootStderrDiagnostic(stderrTail: string): string {
  return `${classifyBootStderr(stderrTail)}.\n--- VMM stderr tail ---\n${stderrTail}`;
}

function classifyBootStderr(stderrTail: string): string {
  if (/Kernel panic - not syncing|Oops:|general protection fault/i.test(stderrTail)) {
    return "guest kernel panic/oops before exec-agent readiness";
  }
  return "guest did not reach exec-agent readiness";
}
