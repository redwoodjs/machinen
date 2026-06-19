import { attach, runGc, validatePid, type RegistryEntry } from "@machinen/runtime";

import type { Target } from "../parse-target.ts";
import { describeTarget, lookupEntry, parseTargetFlags } from "./target.ts";

// `machinen stop <name|pid>` — SIGTERM the VMM, escalate to SIGKILL
// after 2s, then gc its entry. Resolves `--detached` boots' Ctrl-C
// problem: the CLI no longer holds the VMM, so a separate `stop`
// command is the only way to ask for a clean shutdown.
export async function cmdStop(args: string[]): Promise<number> {
  const opts = parseStopOptions(args);
  const entry = lookupEntry(opts.target);
  if (!entry) {
    reportStopMissingTarget(opts);
    return 1;
  }
  return stopExistingEntry(entry, opts);
}

async function stopExistingEntry(entry: RegistryEntry, opts: StopOptions): Promise<number> {
  const status = validateStopEntry(entry);
  if (await handleInactiveStopEntry(entry, status, opts)) {
    return 0;
  }
  if (opts.dryRun) {
    reportStopDryRun(entry, opts);
    return 0;
  }
  return stopLiveEntry(entry, opts);
}

async function stopLiveEntry(entry: RegistryEntry, opts: StopOptions): Promise<number> {
  await syncBatchLiveMountsBeforeStop(entry, opts);
  const sig = stopSignal(opts.force);
  if (!signalStopProcess(entry.pid, sig, opts, "STOP_KILL_FAILED")) {
    return 1;
  }
  await escalateIfNeeded(entry.pid, opts.force);
  await stopGvproxy(entry, sig, opts.force);
  finishStoppedEntry(entry, opts);
  return 0;
}

async function syncBatchLiveMountsBeforeStop(
  entry: RegistryEntry,
  opts: StopOptions,
): Promise<void> {
  if (opts.force || !entry.liveMounts?.some((mount) => mount.sync === "batch")) {
    return;
  }
  try {
    const vm = await attach({ pid: entry.pid });
    try {
      await vm.execRaw("true", { execTimeoutMs: 300_000 });
    } finally {
      await vm.detach().catch(() => undefined);
    }
  } catch (err) {
    process.stderr.write(
      `machinen stop: warning: failed to sync batch live mounts before stop: ${formatStopSyncError(err)}\n`,
    );
  }
}

function formatStopSyncError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type StopStatus = "stopped" | "would_stop" | "already_dead" | "recycled";

interface StopOptions {
  json: boolean;
  dryRun: boolean;
  force: boolean;
  target: Target;
}

function parseStopOptions(args: string[]): StopOptions {
  const { json, rest: afterJson } = consumeJsonFlag(args);
  const { dryRun, rest: afterDry } = consumeDryRunFlag(afterJson);
  const { force, rest } = consumeForceFlag(afterDry);
  return { json, dryRun, force, target: parseTargetFlags(rest, "stop") };
}

function consumeForceFlag(args: string[]): { force: boolean; rest: string[] } {
  const rest: string[] = [];
  let force = false;
  for (const arg of args) {
    if (arg === "--force" || arg === "-9") {
      force = true;
    } else {
      rest.push(arg);
    }
  }
  return { force, rest };
}

function reportStopMissingTarget(opts: StopOptions): void {
  const message = `no running VM matched ${describeTarget(opts.target)}`;
  if (opts.json) {
    emitJsonError("VM_NOT_FOUND", message);
  } else {
    process.stderr.write(`machinen stop: ${message}\n`);
  }
}

function emitStop(entry: RegistryEntry, opts: StopOptions, status: StopStatus): void {
  if (!opts.json) {
    return;
  }
  emitJson({
    schema_version: 1,
    pid: entry.pid,
    name: entry.name ?? null,
    status,
    dry_run: opts.dryRun,
  });
}

function validateStopEntry(entry: RegistryEntry) {
  // Pid-validate before signalling — refuses to kill a recycled pid.
  return validatePid(entry.pid, {
    vmmExe: entry.vmmExe,
    startedAt: entry.startedAt,
  });
}

async function handleInactiveStopEntry(
  entry: RegistryEntry,
  status: ReturnType<typeof validateStopEntry>,
  opts: StopOptions,
): Promise<boolean> {
  if (status === "recycled") {
    reportRecycledStopEntry(entry, opts);
    gcStoppedEntry(entry, opts.dryRun);
    emitStop(entry, opts, "recycled");
    return true;
  }
  if (status === "dead") {
    reportDeadStopEntry(entry, opts);
    gcStoppedEntry(entry, opts.dryRun);
    emitStop(entry, opts, "already_dead");
    return true;
  }
  return false;
}

function reportRecycledStopEntry(entry: RegistryEntry, opts: StopOptions): void {
  if (opts.json) {
    return;
  }
  process.stderr.write(
    `machinen stop: registry entry pid ${entry.pid} is now held by an unrelated process; ` +
      (opts.dryRun ? "would skip kill and gc.\n" : "skipping kill and running gc.\n"),
  );
}

function reportDeadStopEntry(entry: RegistryEntry, opts: StopOptions): void {
  if (opts.json) {
    return;
  }
  process.stderr.write(
    `machinen stop: pid ${entry.pid} already gone; ` +
      (opts.dryRun ? "would gc.\n" : "running gc.\n"),
  );
}

function gcStoppedEntry(entry: RegistryEntry, dryRun: boolean): void {
  if (!dryRun) {
    runGc({ pid: entry.pid });
  }
}

function reportStopDryRun(entry: RegistryEntry, opts: StopOptions): void {
  if (!opts.json) {
    const sigLabel = opts.force ? "SIGKILL" : "SIGTERM (escalates to SIGKILL after 2s)";
    process.stdout.write(`would ${sigLabel} ${entryLabel(entry)}\n`);
  }
  emitStop(entry, opts, "would_stop");
}

function stopSignal(force: boolean): NodeJS.Signals {
  return force ? "SIGKILL" : "SIGTERM";
}

function signalStopProcess(
  pid: number,
  signal: NodeJS.Signals,
  opts: Pick<StopOptions, "json">,
  errorCode: string,
): boolean {
  try {
    process.kill(pid, signal);
    return true;
  } catch (err) {
    reportStopSignalError(pid, err, opts, errorCode);
    return false;
  }
}

function reportStopSignalError(
  pid: number,
  err: unknown,
  opts: Pick<StopOptions, "json">,
  errorCode: string,
): void {
  const msg = `failed to signal pid ${pid}: ${describeError(err)}`;
  if (opts.json) {
    emitJsonError(errorCode, msg);
  } else {
    process.stderr.write(`machinen stop: ${msg}\n`);
  }
}

async function escalateIfNeeded(pid: number, force: boolean): Promise<void> {
  if (force) {
    return;
  }
  await waitForExit(pid, 2_000);
  if (pidIsAlive(pid)) {
    tryKill(pid, "SIGKILL");
  }
}

function pidIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function tryKill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch {}
}

async function stopGvproxy(
  entry: RegistryEntry,
  signal: NodeJS.Signals,
  force: boolean,
): Promise<void> {
  // #150 phase 2 PR3: signal gvproxy too. Detached gvproxy survives
  // the parent's exit on its own (no pdeathsig); without this it'd
  // outlive every `machinen stop`, holding host ports and leaking
  // the qemu/control sockets. Anti-recycling guard mirrors the VMM
  // path — basename match against the recorded gvproxy binary.
  if (!entry.gvproxyPid || !entry.gvproxyExe) {
    return;
  }
  await handleGvproxyStatus(
    entry.gvproxyPid,
    validatePid(entry.gvproxyPid, { vmmExe: entry.gvproxyExe }),
    signal,
    force,
  );
}

async function handleGvproxyStatus(
  pid: number,
  status: ReturnType<typeof validatePid>,
  signal: NodeJS.Signals,
  force: boolean,
): Promise<void> {
  if (status === "alive") {
    await signalGvproxy(pid, signal, force);
  } else if (status === "recycled") {
    process.stderr.write(
      `machinen stop: gvproxy pid ${pid} now held by an unrelated process; skipping.\n`,
    );
  }
}

async function signalGvproxy(pid: number, signal: NodeJS.Signals, force: boolean): Promise<void> {
  if (!signalStopProcess(pid, signal, { json: false }, "STOP_GVPROXY_KILL_FAILED")) {
    return;
  }
  await escalateIfNeeded(pid, force);
}

function finishStoppedEntry(entry: RegistryEntry, opts: StopOptions): void {
  // Final gc to drop the registry entry + cleanupPaths (including the
  // gvproxy socket dir that PR3 added to the cleanup list).
  runGc({ pid: entry.pid });
  if (opts.json) {
    emitStop(entry, opts, "stopped");
  } else {
    process.stdout.write(`stopped ${entryLabel(entry)}\n`);
  }
}

function entryLabel(entry: RegistryEntry): string {
  return entry.name ? `${entry.name} (pid ${entry.pid})` : `pid ${entry.pid}`;
}

/**
 * Poll `kill(pid, 0)` until the process is gone or the deadline
 * passes. Polling beats kqueue/inotify here — the pid we're watching
 * is *not* our child, so there's no SIGCHLD to listen for.
 */
async function waitForExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function consumeJsonFlag(args: string[]): { json: boolean; rest: string[] } {
  const rest: string[] = [];
  let json = false;
  for (const arg of args) {
    if (arg === "--json") {
      json = true;
    } else {
      rest.push(arg);
    }
  }
  return { json, rest };
}

function consumeDryRunFlag(args: string[]): { dryRun: boolean; rest: string[] } {
  const rest: string[] = [];
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else {
      rest.push(arg);
    }
  }
  return { dryRun, rest };
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function emitJsonError(code: string, message: string): void {
  emitJson({ schema_version: 1, ok: false, error: { code, message } });
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
