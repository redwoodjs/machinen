import { formatMachinenError, isMachinenError } from "@machinen/runtime";

import { printDiagnostics, type RingBuffer } from "./quiet.ts";

export function die(msg: string): never {
  process.stderr.write(`machinen: ${msg}\n`);
  process.exit(1);
}

/**
 * Unified error handler. MachinenError gets a formatted `(CODE): message`
 * + cause chain and an exit(1). Anything else re-throws so Node prints
 * the full stack — those are genuine surprises we want to see.
 */
export function handleError(err: unknown): never {
  if (isMachinenError(err)) {
    process.stderr.write(`machinen: ${formatMachinenError(err)}\n`);
    process.exit(1);
  }
  throw err;
}

/**
 * Print a failure summary + diagnostics envelope and exit non-zero.
 * Used by boot/restore/fork/snapshot/install when a buffered tail of
 * suppressed output would otherwise be lost.
 */
export function failQuiet(
  summary: string,
  opts: { buffer?: RingBuffer | string; tails?: Record<string, string> } = {},
): never {
  printDiagnostics(summary, opts);
  process.exit(1);
}

export function describeError(err: unknown): string {
  if (isMachinenError(err)) {
    return formatMachinenError(err);
  }
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
