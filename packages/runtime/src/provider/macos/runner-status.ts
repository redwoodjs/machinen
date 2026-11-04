// Runner status file reader.
//
// The Swift runner writes a small JSON document as it moves through its
// lifecycle. The runtime polls it instead of inferring readiness from a
// successful spawn, because `start()` returning is not proof that the
// guest is reachable.

import { existsSync, readFileSync } from "node:fs";

import { BootError } from "../../errors.ts";

export type RunnerState = "starting" | "running" | "stopping" | "stopped" | "failed";

export interface RunnerStatus {
  state: RunnerState;
  /** Guest address the runner observed, when it has one. */
  address?: string;
  /** Human-readable failure detail. Never contains secret material. */
  error?: string;
  /** ms epoch the status was written. */
  updatedAt?: number;
}

const VALID_STATES: readonly RunnerState[] = [
  "starting",
  "running",
  "stopping",
  "stopped",
  "failed",
];

/** Read and validate a status file. Returns undefined when absent. */
export function readRunnerStatus(path: string): RunnerStatus | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    // A partially written file is expected while the runner is starting.
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const state = record.state;
  if (typeof state !== "string" || !(VALID_STATES as readonly string[]).includes(state)) {
    return undefined;
  }
  const status: RunnerStatus = { state: state as RunnerState };
  if (typeof record.address === "string" && record.address.length > 0) {
    status.address = record.address;
  }
  if (typeof record.error === "string" && record.error.length > 0) {
    status.error = record.error;
  }
  if (typeof record.updatedAt === "number") {
    status.updatedAt = record.updatedAt;
  }
  return status;
}

/**
 * Poll until the runner reports `running` or the deadline passes. A
 * `failed` status short-circuits, and so does a dead runner.
 */
export async function waitForRunnerRunning(args: {
  statusPath: string;
  timeoutMs: number;
  pollMs?: number;
  isAlive: () => boolean;
}): Promise<RunnerStatus> {
  const deadline = Date.now() + args.timeoutMs;
  const pollMs = args.pollMs ?? 100;
  let last: RunnerStatus | undefined;
  while (Date.now() < deadline) {
    const status = readRunnerStatus(args.statusPath);
    if (status) {
      last = status;
      if (status.state === "running") {
        return status;
      }
      if (status.state === "failed") {
        throw new BootError(
          "PROVIDER_READINESS_FAILED",
          `macOS runner failed before readiness. ${status.error ?? "no detail reported"}`,
        );
      }
    }
    if (!args.isAlive()) {
      throw new BootError(
        "PROVIDER_READINESS_FAILED",
        `macOS runner exited before reporting readiness. ` +
          `Last state ${last?.state ?? "unreported"}.`,
      );
    }
    await delay(pollMs);
  }
  throw new BootError(
    "PROVIDER_READINESS_FAILED",
    `macOS runner did not reach readiness within ${args.timeoutMs}ms. ` +
      `Last state ${last?.state ?? "unreported"}.`,
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}
