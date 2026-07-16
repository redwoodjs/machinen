import { argValue, consumeJsonFlag, emitJson } from "../args.ts";
import { RELEASE_TAG, baseAssetsComplete, cacheDirFor, ensureBaseAssets } from "../base-assets.ts";
import { describeError, failQuiet } from "../errors.ts";
import { formatElapsed, isQuiet } from "../quiet.ts";

export async function cmdInstall(args: string[]): Promise<number> {
  const opts = parseInstallOptions(args);
  const result = await installBaseAssets(opts);
  reportInstallResult(opts, result);
  return 0;
}

interface InstallOptions {
  json: boolean;
  tag: string;
}

interface InstallResult {
  base: string;
  wasComplete: boolean;
  elapsedMs: number;
}

function parseInstallOptions(args: string[]): InstallOptions {
  const { json, rest } = consumeJsonFlag(args);
  return { json, tag: argValue(rest, "--version") ?? RELEASE_TAG };
}

async function installBaseAssets(opts: InstallOptions): Promise<InstallResult> {
  const wasComplete = baseAssetsComplete(opts.tag);
  const t0 = Date.now();
  printInstallStart(opts);
  try {
    const base = await ensureBaseAssets(opts.tag, { progress: !opts.json });
    return { base, wasComplete, elapsedMs: Date.now() - t0 };
  } catch (err) {
    reportInstallFailure(opts, err);
    throw err;
  }
}

function printInstallStart(opts: InstallOptions): void {
  if (opts.json) {
    return;
  }
  process.stderr.write(`installing base assets for ${opts.tag}…\n`);
  if (!isQuiet()) {
    process.stderr.write(`  into ${cacheDirFor(opts.tag)}\n`);
  }
}

function reportInstallFailure(opts: InstallOptions, err: unknown): void {
  if (isQuiet() && !opts.json) {
    failQuiet(`install ${opts.tag} failed: ${describeError(err)}`);
  }
}

function reportInstallResult(opts: InstallOptions, result: InstallResult): void {
  if (opts.json) {
    emitInstallJson(opts, result);
    return;
  }
  printInstallReady(result);
}

function emitInstallJson(opts: InstallOptions, result: InstallResult): void {
  emitJson({
    schema_version: 1,
    tag: opts.tag,
    base_dir: result.base,
    fetched: !result.wasComplete,
  });
}

function printInstallReady(result: InstallResult): void {
  if (result.wasComplete) {
    process.stderr.write(`ready: ${result.base} (cached)\n`);
    return;
  }
  process.stderr.write(`ready in ${formatElapsed(result.elapsedMs)}: ${result.base}\n`);
}
