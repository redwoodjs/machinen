import { restore, type VmHandle } from "@machinen/runtime";
import { resolve } from "node:path";
import {
  deriveBootName,
  resolveCliBaseAssets,
  resolveOptionalImageOverride,
  type CliBaseAssetPaths,
} from "../base-assets.ts";
import { describeError, die, failQuiet, handleError } from "../errors.ts";
import { parseRestoreArgs } from "../parse-restore-args.ts";
import { formatElapsed, isQuiet, NoiseFilter, printHeadline, RingBuffer } from "../quiet.ts";
import { guestConsoleOnLog, runAttachedVmSession, type QuietRunState } from "../session.ts";

type ParsedRestoreCommandArgs = ReturnType<typeof parseRestoreArgs>;

// fallow-ignore-next-line complexity
export async function cmdRestore(args: string[]): Promise<number> {
  // `machinen restore <snap-dir> [--image <tarball>] [--name <name>]
  // [--lazy] [-p <hostPort>:<guestPort>]`. Restore is eager by
  // default; `--lazy` opts into the #266 CRIU lazy-pages path.
  const parsed = parseRestoreCommandArgs(args);
  validateRestoreCommandArgs(parsed);
  const snapDir = resolve(parsed.positional[0]!);
  const paths = await resolveCliBaseAssets();
  const quiet = createRestoreQuietState(parsed, snapDir);
  const vm = await startRestoreVm(parsed, snapDir, paths, quiet);
  reportRestoreSuccess(vm, quiet);
  return runRestoreAttachedSession(vm, quiet);
}

function parseRestoreCommandArgs(args: string[]): ParsedRestoreCommandArgs {
  try {
    return parseRestoreArgs(args);
  } catch (err) {
    handleError(err);
  }
}

function validateRestoreCommandArgs(parsed: ParsedRestoreCommandArgs): void {
  if (parsed.positional.length !== 1) {
    die(restoreUsage());
  }
}

function restoreUsage(): string {
  return (
    "usage: machinen restore <snap-dir> [--image <tarball>] [--name <name>] " +
    "[--lazy] [-p <hostPort>:<guestPort>] " +
    "[--mount-live <host>:<guest>[:<mode>]]\n"
  );
}

function createRestoreQuietState(parsed: ParsedRestoreCommandArgs, snapDir: string): QuietRunState {
  const headlineName = parsed.name ?? deriveBootName(snapDir);
  const buffer = new RingBuffer();
  if (!isQuiet()) {
    return { headlineName, showHeadlines: false, buffer, filter: null, filterOut: null };
  }
  printHeadline(`restoring ${headlineName}…`);
  return restoreFilteredQuietState(headlineName, buffer, Date.now());
}

function restoreFilteredQuietState(
  headlineName: string,
  buffer: RingBuffer,
  restoreT0: number,
): QuietRunState {
  // onReady fires on the first non-noise line — typically the
  // restored workload's first stdout/stderr write. We print the
  // "restored" headline there so timing is wall-clock honest.
  const filter = new NoiseFilter({
    buffer,
    out: process.stderr,
    onReady: () => {
      printHeadline(`restored in ${formatElapsed(Date.now() - restoreT0)}`);
    },
  });
  return {
    headlineName,
    showHeadlines: true,
    buffer,
    filter,
    filterOut: null,
    onLog: guestConsoleOnLog((chunk) => filter.push(chunk)),
  };
}

async function startRestoreVm(
  parsed: ParsedRestoreCommandArgs,
  snapDir: string,
  paths: CliBaseAssetPaths,
  quiet: QuietRunState,
): Promise<VmHandle> {
  try {
    return await restore({
      snapDir,
      image: resolveOptionalImageOverride(parsed.image),
      kernel: paths.kernelPath,
      dtb: paths.dtbPath,
      name: parsed.name,
      lazy: parsed.lazy,
      portForward: optionalList(parsed.portForward),
      // #273: per-guest overrides for the bundle's recorded
      // liveMounts. Empty list = use the bundle's recorded mounts
      // verbatim; non-empty entries replace the matching guest's
      // host/mode (BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN if no match).
      liveMounts: optionalList(parsed.liveMounts),
      timeoutMs: null,
      onLog: quiet.onLog,
    });
  } catch (err) {
    handleRestoreFailure(err, quiet);
  }
}

function optionalList<T>(items: T[]): T[] | undefined {
  if (items.length === 0) {
    return undefined;
  }
  return items;
}

// fallow-ignore-next-line code-duplication
function handleRestoreFailure(err: unknown, quiet: QuietRunState): never {
  quiet.filter?.flush();
  if (quiet.showHeadlines) {
    failQuiet(`restore ${quiet.headlineName} failed: ${describeError(err)}`, {
      buffer: quiet.buffer,
    });
  }
  handleError(err);
}

function reportRestoreSuccess(vm: VmHandle, quiet: QuietRunState): void {
  if (!quiet.showHeadlines) {
    process.stderr.write(`restored as: ${vm.name ?? "<anonymous>"} (pid ${vm.pid})\n`);
  }
}

function runRestoreAttachedSession(vm: VmHandle, quiet: QuietRunState): Promise<number> {
  return runAttachedVmSession(vm, {
    filter: quiet.filter,
    buffer: quiet.buffer,
    preReadyExitSummary: (code) =>
      `restore ${quiet.headlineName} exited ${code} before reaching ready`,
  });
}
