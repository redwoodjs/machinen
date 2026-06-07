import { attach, type LogEvent, type VmHandle } from "@machinen/runtime";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { consumeJsonFlag, emitJson } from "../args.ts";
import { resolveCliBaseAssets, type CliBaseAssetPaths } from "../base-assets.ts";
import { describeError, die, failQuiet, handleError } from "../errors.ts";
import { parseForkArgs } from "../parse-fork-args.ts";
import { extractTarget, type Target } from "../parse-target.ts";
import { formatElapsed, isQuiet, NoiseFilter, printHeadline, RingBuffer } from "../quiet.ts";
import {
  bootBufferOnlyQuietState,
  guestConsoleOnLog,
  runAttachedVmSession,
  type QuietRunState,
} from "../session.ts";

function optionalList<T>(items: T[]): T[] | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items;
}

type ParsedForkCommandArgs = ReturnType<typeof parseForkArgs>;

export async function cmdFork(args: string[]): Promise<number> {
  const opts = await prepareForkCommand(args);
  const vm = await attach(opts.target).catch(handleError);
  try {
    const fork = await startForkVm(vm, opts);
    reportForkStarted(fork, opts);
    if (opts.parsed.detach) {
      return detachFork(fork, opts);
    }
    return runForkAttachedSession(fork, opts.quiet);
  } catch (err) {
    handleError(err);
  } finally {
    await vm.detach();
  }
}

interface ForkCommandOptions {
  json: boolean;
  target: Target;
  parsed: ParsedForkCommandArgs;
  paths: CliBaseAssetPaths;
  resolvedOutDir: string;
  quiet: QuietRunState;
}

async function prepareForkCommand(args: string[]): Promise<ForkCommandOptions> {
  const { json, rest } = consumeJsonFlag(args);
  const parsed = parseForkCommandArgs(rest);
  const target = parseTargetFlags(parsed.rest, "fork");
  validateForkCommand(json, parsed);
  const paths = await resolveCliBaseAssets();
  const resolvedOutDir = resolveForkOutDir(parsed.outDir);
  return {
    json,
    target,
    parsed,
    paths,
    resolvedOutDir,
    quiet: createForkQuietState(json, parsed, target),
  };
}

function parseForkCommandArgs(args: string[]): ParsedForkCommandArgs {
  try {
    return parseForkArgs(args);
  } catch (err) {
    handleError(err);
  }
}

function validateForkCommand(json: boolean, parsed: ParsedForkCommandArgs): void {
  if (json && !parsed.detach) {
    die("fork --json is only meaningful with --detach (attached forks take over stdio).");
  }
}

function resolveForkOutDir(outDir: string | undefined): string {
  // The runtime's ephemeral-bundle cleanup hangs off `fork.wait()`,
  // which the CLI can't await — `cmdFork` returns as soon as the
  // fork is registered. So the CLI always materializes an explicit
  // outDir (caller-supplied or a temp dir we print) and skips the
  // runtime's ephemeral mode.
  if (outDir) {
    return resolve(outDir);
  }
  return mkdtempSync(join(tmpdir(), "machinen-fork-"));
}

function createForkQuietState(
  json: boolean,
  parsed: ParsedForkCommandArgs,
  target: Target,
): QuietRunState {
  const sourceLabel = describeForkSource(target);
  const headlineName = parsed.newName ?? sourceLabel;
  const buffer = new RingBuffer();
  if (!shouldShowForkHeadlines(json, parsed)) {
    return forkOperatorQuietState(headlineName, buffer);
  }
  return createVisibleForkQuietState(parsed, sourceLabel, headlineName, buffer);
}

function shouldShowForkHeadlines(json: boolean, parsed: ParsedForkCommandArgs): boolean {
  if (!isQuiet()) {
    return false;
  }
  if (parsed.detach && json) {
    return false;
  }
  return true;
}

function createVisibleForkQuietState(
  parsed: ParsedForkCommandArgs,
  sourceLabel: string,
  headlineName: string,
  buffer: RingBuffer,
): QuietRunState {
  printHeadline(`forking ${sourceLabel} → ${headlineName}…`);
  if (parsed.detach) {
    return bootBufferOnlyQuietState(headlineName, true, buffer);
  }
  return forkFilteredQuietState(headlineName, true, buffer, Date.now());
}

function describeForkSource(target: Target): string {
  return "name" in target ? target.name : `pid ${target.pid}`;
}

function forkOperatorQuietState(headlineName: string, buffer: RingBuffer): QuietRunState {
  return {
    headlineName,
    showHeadlines: false,
    buffer,
    filter: null,
    filterOut: null,
    onLog: operatorForkOnLog,
  };
}

function operatorForkOnLog(evt: LogEvent): void {
  // Operator mode: legacy live-stream of every non-phase chunk (the
  // runtime emits phase events too — those are timing metadata, not
  // console output, so they're filtered out).
  if (evt.source !== "phase") {
    process.stderr.write(evt.chunk);
  }
}

function forkFilteredQuietState(
  headlineName: string,
  showHeadlines: boolean,
  buffer: RingBuffer,
  forkT0: number,
): QuietRunState {
  const filter = new NoiseFilter({
    buffer,
    out: process.stderr,
    onReady: () => {
      printHeadline(`fork ready in ${formatElapsed(Date.now() - forkT0)}`);
    },
  });
  return {
    headlineName,
    showHeadlines,
    buffer,
    filter,
    filterOut: null,
    onLog: guestConsoleOnLog((chunk) => filter.push(chunk)),
  };
}

async function startForkVm(vm: VmHandle, opts: ForkCommandOptions): Promise<VmHandle> {
  try {
    return await vm.fork({
      name: opts.parsed.newName,
      outDir: opts.resolvedOutDir,
      image: opts.paths.defaultImagePath,
      kernel: opts.paths.kernelPath,
      dtb: opts.paths.dtbPath,
      tcpKeep: opts.parsed.tcpKeep,
      lazy: opts.parsed.lazy,
      portForward: optionalList(opts.parsed.portForward),
      mount: opts.parsed.mount,
      liveMounts: opts.parsed.liveMounts,
      env: opts.parsed.env,
      guestCwd: opts.parsed.guestCwd,
      memory: opts.parsed.memory,
      onLog: opts.quiet.onLog,
    });
  } catch (err) {
    handleForkFailure(err, opts.quiet);
  }
}

// fallow-ignore-next-line code-duplication
function handleForkFailure(err: unknown, quiet: QuietRunState): never {
  quiet.filter?.flush();
  if (quiet.showHeadlines) {
    failQuiet(`fork ${quiet.headlineName} failed: ${describeError(err)}`, {
      buffer: quiet.buffer,
    });
  }
  handleError(err);
}

function reportForkStarted(fork: VmHandle, opts: ForkCommandOptions): void {
  if (!shouldPrintForkStarted(opts)) {
    return;
  }
  process.stderr.write(`forked: ${fork.name ?? "<anonymous>"} (pid ${fork.pid})\n`);
  printForkBundleHint(opts);
}

function shouldPrintForkStarted(opts: ForkCommandOptions): boolean {
  if (opts.quiet.showHeadlines) {
    return false;
  }
  return !opts.json;
}

function printForkBundleHint(opts: ForkCommandOptions): void {
  if (!opts.parsed.outDir) {
    process.stderr.write(`bundle: ${opts.resolvedOutDir} (rm -rf when the fork exits)\n`);
  }
}

async function detachFork(fork: VmHandle, opts: ForkCommandOptions): Promise<number> {
  // Fire-and-forget: hand the fork off to its own VMM process
  // (boot was spawned with pdeathsig=false so it survives this CLI exit) and return.
  await fork.detach();
  if (opts.json) {
    emitJson({
      schema_version: 1,
      pid: fork.pid,
      name: fork.name ?? null,
      source: describeForkSource(opts.target),
      bundle_dir: opts.resolvedOutDir,
      ephemeral: !opts.parsed.outDir,
    });
  }
  return 0;
}

async function runForkAttachedSession(fork: VmHandle, quiet: QuietRunState): Promise<number> {
  const cancelPromptNudge = scheduleForkPromptNudge(fork);
  try {
    return await runAttachedVmSession(fork, {
      filter: quiet.filter,
      buffer: quiet.buffer,
      preReadyExitSummary: (code) =>
        `fork ${quiet.headlineName} exited ${code} before reaching ready`,
    });
  } finally {
    cancelPromptNudge();
  }
}

function scheduleForkPromptNudge(fork: VmHandle): () => void {
  // The source shell printed PS1 to the source's tty before the dump,
  // so the restored shell starts up sitting in read() without redrawing.
  const promptNudge = setTimeout(() => tryWriteForkPromptNudge(fork), 1500);
  promptNudge.unref();
  return () => clearTimeout(promptNudge);
}

function tryWriteForkPromptNudge(fork: VmHandle): void {
  try {
    fork.stdin.write("\r");
  } catch {
    // fork already exited / pipe closed — nothing to nudge.
  }
}

function resolveTarget(args: string[], cmd: string): { target: Target; rest: string[] } {
  try {
    return extractTarget(args, cmd);
  } catch (err) {
    handleError(err);
  }
}

function parseTargetFlags(args: string[], cmd: string): Target {
  const { target, rest } = resolveTarget(args, cmd);
  if (rest.length > 0) {
    die(`unknown argument: ${rest[0]}`);
  }
  return target;
}
