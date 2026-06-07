import {
  isNodeLevel5ProductSnapshotBundle,
  restore,
  restoreNodeLevel5DeclaredSubset,
  restoreNodeLevel5ProductSnapshot,
  type VmHandle,
} from "@machinen/runtime";
import { resolve } from "node:path";
import {
  cmdRestoreCleanService as restoreCleanServiceBundle,
  shouldRestoreCleanService as shouldRestoreCleanServiceBundle,
} from "../clean-service/restore.ts";
import { consumeJsonFlag, emitJson, emitJsonError } from "../args.ts";
import {
  deriveBootName,
  guestCpu,
  resolveCliBaseAssets,
  resolveOptionalImageOverride,
  type CliBaseAssetPaths,
} from "../base-assets.ts";
import {
  detectLevel5RestoreAdapter,
  restoreLevel5RuntimeBundle,
} from "../level5-runtime-adapters.ts";
import { describeError, die, failQuiet, handleError } from "../errors.ts";
import { parseRestoreArgs } from "../parse-restore-args.ts";
import {
  parseNodeLevel5DeclaredSubsetRestoreArgs,
  reportNodeLevel5DeclaredSubsetCliRefusal,
  reportNodeLevel5DeclaredSubsetSummary,
} from "./node-level5-shared.ts";
import { formatElapsed, isQuiet, NoiseFilter, printHeadline, RingBuffer } from "../quiet.ts";
import { guestConsoleOnLog, runAttachedVmSession, type QuietRunState } from "../session.ts";
import {
  cmdRestorePortableNode,
  shouldPreferVmstateRestore,
  shouldRestorePortableNode,
} from "./restore-portable-node.ts";

type ParsedRestoreCommandArgs = ReturnType<typeof parseRestoreArgs>;

function cmdRestoreNodeLevel5DeclaredSubset(input: { json: boolean; rest: string[] }): number {
  const options = parseNodeLevel5DeclaredSubsetRestoreArgs(input.rest);
  if (!options.manifest) {
    reportNodeLevel5DeclaredSubsetCliRefusal(
      input.json,
      "node-level5-declared-subset-manifest-required",
      "machinen restore node-level5 requires <manifest> or --manifest <file>",
    );
  }
  const summary = restoreNodeLevel5DeclaredSubset({
    manifestPath: resolve(options.manifest),
    experimental: options.experimental,
    rawCpuRestore: options.rawCpuRestore,
    productSupportClaimed: options.productSupportClaimed,
  });
  return reportNodeLevel5DeclaredSubsetSummary(input.json, summary, {
    accepted: (value) =>
      `accepted experimental node-level5 restore manifest: ${value.manifestPath}\n`,
    refused: (value) => `refused experimental node-level5 restore: ${value.refusal?.code}\n`,
  });
}

// fallow-ignore-next-line complexity
export async function cmdRestore(args: string[]): Promise<number> {
  // `machinen restore <snap-dir> [--image <tarball>] [--name <name>]
  // [--lazy] [-p <hostPort>:<guestPort>]`. Restore is eager by
  // default; `--lazy` opts into the #266 CRIU lazy-pages path.
  const { json, rest } = consumeJsonFlag(args);
  if (rest[0] === "node-level5") {
    return cmdRestoreNodeLevel5DeclaredSubset({ json, rest: rest.slice(1) });
  }
  const parsed = parseRestoreCommandArgs(rest);
  validateRestoreCommandArgs(parsed);
  const snapDir = resolve(parsed.positional[0]!);
  if (isNodeLevel5ProductSnapshotBundle(snapDir)) {
    return cmdRestoreNodeLevel5ProductSnapshot(snapDir, json);
  }
  if (!shouldPreferVmstateRestore(snapDir)) {
    if (isNodeLevel5ProofCompositionBundle(snapDir)) {
      return await cmdRestoreNodeLevel5ProofComposition(snapDir, json, parsed);
    }
    if (shouldRestoreCleanServiceBundle(snapDir, guestCpu)) {
      return restoreCleanServiceBundle({
        snapDir,
        json,
        name: parsed.name,
        resolveCliBaseAssets,
        guestCpu,
        deriveBootName,
        emitJson,
        shellQuote,
      });
    }
    if (shouldRestorePortableNode(snapDir)) {
      return cmdRestorePortableNode(parsed, snapDir, json);
    }
  }
  if (json) {
    die("restore --json is only supported for supported descriptor restore paths");
  }
  const paths = await resolveCliBaseAssets();
  const quiet = createRestoreQuietState(parsed, snapDir);
  const vm = await startRestoreVm(parsed, snapDir, paths, quiet);
  reportRestoreSuccess(vm, quiet);
  return runRestoreAttachedSession(vm, quiet);
}

function cmdRestoreNodeLevel5ProductSnapshot(snapDir: string, json: boolean): number {
  try {
    return reportNodeLevel5ProductSnapshotRestore(
      restoreNodeLevel5ProductSnapshot({ snapshotDir: snapDir }),
      json,
    );
  } catch (error) {
    return reportNodeLevel5ProductSnapshotRestoreError(error, json);
  }
}

function reportNodeLevel5ProductSnapshotRestore(
  summary: ReturnType<typeof restoreNodeLevel5ProductSnapshot>,
  json: boolean,
): number {
  if (json) {
    emitJson(summary);
  } else {
    process.stdout.write(`restored node snapshot: ${summary.familyId} ${summary.direction}\n`);
  }
  return summary.accepted ? 0 : 1;
}

function reportNodeLevel5ProductSnapshotRestoreError(error: unknown, json: boolean): number {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    emitJsonError("node-level5-product-snapshot-invalid", message);
  } else {
    process.stderr.write(`machinen restore: ${message}\n`);
  }
  return 1;
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
    "[--mount-live <host>:<guest>[:<mode>]]\n" +
    "       machinen restore <node-level5-proof-bundle> " +
    "[--allow-proof-only-success] [--json]\n" +
    "       machinen restore node-level5 --experimental-node-level5 <manifest> [--json]"
  );
}

function isNodeLevel5ProofCompositionBundle(snapDir: string): boolean {
  return detectLevel5RestoreAdapter(snapDir) !== undefined;
}

async function cmdRestoreNodeLevel5ProofComposition(
  snapDir: string,
  json: boolean,
  parsed: ParsedRestoreCommandArgs,
): Promise<number> {
  const result = await restoreLevel5RuntimeBundle(snapDir, {
    verifyProofOnly: parsed.verifyProofOnly,
    allowProofOnlySuccess: parsed.allowProofOnlySuccess,
    targetRestore: {
      name: parsed.name,
      portForward: parsed.portForward,
      resolveCliBaseAssets,
      deriveBootName,
      shellQuote,
    },
  });
  if (json) {
    emitJson({ schema_version: 1, ...result.summary });
  } else {
    const targetProof = result.summary.targetProof;
    process.stderr.write(
      `Node Level 5 proof verifier: ${targetProof.status}; target-native Node continuation observed=${targetProof.targetVerifierObservedActualNodeContinuation}; noSourceIsaEmulation=${targetProof.noSourceIsaEmulation}; noSidecarOutput=${targetProof.noSidecarOutput}; noMetadataOnlySuccess=${targetProof.noMetadataOnlySuccess}\n`,
    );
    if (result.summary.refusal) {
      process.stderr.write(`${result.summary.refusal.message}\n`);
    } else {
      process.stderr.write(
        "Node Level 5 HTTP profile restore completed selected state continuation\n",
      );
    }
  }
  return result.exitCode;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
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
