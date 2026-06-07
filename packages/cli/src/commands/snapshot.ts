import { attach, type LogEvent, type RegistryEntry, type VmHandle } from "@machinen/runtime";
import { resolve } from "node:path";

import { consumeDryRunFlag, consumeJsonFlag, emitJson, emitJsonError } from "../args.ts";
import { describeError, die, failQuiet, handleError } from "../errors.ts";
import type { Target } from "../parse-target.ts";
import { isQuiet, printHeadline, RingBuffer } from "../quiet.ts";
import type { QuietRunState } from "../session.ts";
import { takeFlagValue } from "../args.ts";
import { describeTarget, entryLabel, lookupEntry, resolveTarget } from "./target.ts";

export async function cmdSnapshot(args: string[]): Promise<number> {
  const opts = parseSnapshotOptions(args);
  if (opts.dryRun) {
    return snapshotDryRun(opts);
  }
  return runSnapshot(opts);
}

interface SnapshotOptionsCli {
  json: boolean;
  dryRun: boolean;
  keepAlive: boolean;
  target: Target;
  outDir: string;
  resolvedOutDir: string;
}

function parseSnapshotOptions(args: string[]): SnapshotOptionsCli {
  // Forms: `machinen snapshot <target> <out-dir>` and
  // `machinen snapshot <target> --out <dir>`. We strip --json /
  // --dry-run / --keep-alive first; the first positional left is the target.
  const { json, rest: afterJson } = consumeJsonFlag(args);
  const { dryRun, rest: afterDry } = consumeDryRunFlag(afterJson);
  const { keepAlive, rest: afterKeepAlive } = consumeKeepAliveFlag(afterDry);
  const { outDir: flaggedOutDir, rest } = consumeSnapshotOutFlag(afterKeepAlive);
  const { target, rest: afterTarget } = resolveTarget(rest, "snapshot");
  const outDir = parseSnapshotOutDir(afterTarget, flaggedOutDir);
  return { json, dryRun, keepAlive, target, outDir, resolvedOutDir: resolve(outDir) };
}

function consumeKeepAliveFlag(args: string[]): { keepAlive: boolean; rest: string[] } {
  const rest: string[] = [];
  let keepAlive = false;
  for (const arg of args) {
    if (arg === "--keep-alive") {
      keepAlive = true;
    } else {
      rest.push(arg);
    }
  }
  return { keepAlive, rest };
}

function consumeSnapshotOutFlag(args: string[]): { outDir: string | undefined; rest: string[] } {
  const outFlag = args.indexOf("--out");
  if (outFlag === -1) {
    return { outDir: undefined, rest: args };
  }
  const outDir = takeFlagValue(args, outFlag + 1, "--out");
  const rest = args.filter((_, index) => index !== outFlag && index !== outFlag + 1);
  return { outDir, rest };
}

function parseSnapshotOutDir(args: string[], flaggedOutDir?: string): string {
  return flaggedOutDir
    ? parseFlaggedSnapshotOutDir(args, flaggedOutDir)
    : parsePositionalSnapshotOutDir(args);
}

function parseFlaggedSnapshotOutDir(args: string[], flaggedOutDir: string): string {
  if (args.length > 0) {
    die(`unknown argument: ${args[0]}`);
  }
  return flaggedOutDir;
}

function parsePositionalSnapshotOutDir(args: string[]): string {
  if (args.length === 0) {
    die(snapshotUsage());
  }
  if (args.length > 1) {
    die(`unknown argument: ${args[1]}`);
  }
  return args[0]!;
}

function snapshotUsage(): string {
  return (
    "usage: machinen snapshot <name|pid> <out-dir> [--keep-alive] [--dry-run] [--json]\n" +
    "       machinen snapshot <name|pid> --out <dir> [--keep-alive] [--dry-run] [--json]"
  );
}

function snapshotDryRun(opts: SnapshotOptionsCli): number {
  // Validate target exists + out-dir is creatable (parent must exist
  // and be writable). Don't actually freeze the source.
  const entry = lookupEntry(opts.target);
  if (!entry) {
    reportSnapshotMissingTarget(opts);
    return 1;
  }
  reportSnapshotDryRun(entry, opts);
  return 0;
}

function reportSnapshotMissingTarget(opts: SnapshotOptionsCli): void {
  const msg = `no running VM matched ${describeTarget(opts.target)}`;
  if (opts.json) {
    emitJsonError("VM_NOT_FOUND", msg);
  } else {
    process.stderr.write(`machinen snapshot: ${msg}\n`);
  }
}

function reportSnapshotDryRun(entry: RegistryEntry, opts: SnapshotOptionsCli): void {
  if (opts.json) {
    emitSnapshotJson(opts.resolvedOutDir, 0, true);
    return;
  }
  const suffix = opts.keepAlive ? " (--keep-alive)\n" : "\n";
  process.stdout.write(`would snapshot ${entryLabel(entry)} → ${opts.resolvedOutDir}${suffix}`);
}

// fallow-ignore-next-line complexity
async function runSnapshot(opts: SnapshotOptionsCli): Promise<number> {
  const vm = await attach(opts.target).catch(handleError);
  const quiet = createSnapshotQuietState(vm, opts);
  try {
    const res = await vm.snapshot({
      outDir: opts.resolvedOutDir,
      leaveRunning: opts.keepAlive,
      tcpClose: opts.keepAlive,
      onLog: snapshotOnLog(quiet),
    });
    reportSnapshotSuccess(res.snapDir, res.elapsedMs, opts);
    return 0;
  } catch (err) {
    handleSnapshotFailure(err, quiet);
  } finally {
    await vm.detach();
  }
}

function createSnapshotQuietState(vm: VmHandle, opts: SnapshotOptionsCli): QuietRunState {
  // #286: quiet snapshot UX. Snapshot's onLog stream is the CRIU
  // dump-side chatter (machinen-dump.sh + criu's per-phase progress).
  const headlineName = vm.name ?? `pid ${vm.pid}`;
  const showHeadlines = isQuiet() && !opts.json;
  const buffer = new RingBuffer();
  if (showHeadlines) {
    printHeadline(`snapshotting ${headlineName}…`);
  }
  return { headlineName, showHeadlines, buffer, filter: null, filterOut: null };
}

function snapshotOnLog(quiet: QuietRunState): (evt: LogEvent) => void {
  return (evt) => {
    if (evt.source === "phase") {
      return;
    }
    if (quiet.showHeadlines) {
      quiet.buffer.push(evt.chunk);
    } else {
      process.stderr.write(evt.chunk);
    }
  };
}

function reportSnapshotSuccess(snapDir: string, elapsedMs: number, opts: SnapshotOptionsCli): void {
  if (opts.json) {
    emitSnapshotJson(snapDir, elapsedMs, false);
    return;
  }
  process.stdout.write(`snapshot: ${snapDir} (${elapsedMs}ms)\n`);
}

function emitSnapshotJson(snapDir: string, elapsedMs: number, dryRun: boolean): void {
  emitJson({ schema_version: 1, snap_dir: snapDir, elapsed_ms: elapsedMs, dry_run: dryRun });
}

function handleSnapshotFailure(err: unknown, quiet: QuietRunState): never {
  if (quiet.showHeadlines) {
    failQuiet(`snapshot ${quiet.headlineName} failed: ${describeError(err)}`, {
      buffer: quiet.buffer,
    });
  }
  handleError(err);
}
