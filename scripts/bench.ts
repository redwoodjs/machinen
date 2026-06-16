// Raw benchmark capture for #935.
//
// Captures one JSON document per run with:
//   - cold/warm boot phase timing
//   - cold/warm vmstate restore phase timing
//   - snapshot wall time and bundle size for the restore source
//   - raw CPU hash throughput: host native, guest, guest with quota
//   - host RSS after touching guest tmpfs memory at selected sizes
//   - optional live-mount and gvproxy network suites
// Usage:
//   pnpm bench --json-dir bench-results  # defaults to --n 5 --suite all
//   pnpm bench --suite core --guest-arch amd64 --n 1 --json /tmp/machinen-bench.json

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { arch as hostArch, homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runMountBenchSuite, runNetBenchSuite } from "./bench/external-suites.ts";
import {
  assetMetadata,
  filesystemMetadata,
  hostMetadata,
  parseBenchmarkEnvironment,
  parseRootdiskCopyEvents,
  rootdiskCopyJson,
  validateBenchmarkEnvironment,
  type BenchmarkEnvironment,
  type RootdiskCopyEvent,
} from "./bench/metadata.ts";
import { runResourceBench } from "./bench/resource-suite.ts";

type RuntimeMod = typeof import("@machinen/runtime");
let runtime: RuntimeMod | undefined;
async function loadRuntime(): Promise<RuntimeMod> {
  if (!runtime) {
    process.env.DEBUG =
      (process.env.DEBUG ?? "") +
      ",machinen:boot,machinen:restore,machinen:snapshot,machinen:vmstate,machinen:reflink";
    runtime = await import("@machinen/runtime");
  }
  return runtime;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ASSETS = join(REPO_ROOT, "release-assets");
const ROOTFS_IMG_CACHE = join(homedir(), ".cache", "machinen", "rootfs");
const DEFAULT_CPU_BYTES_MIB = 512;
const DEFAULT_MEMORY_SIZES_MIB = [128, 512, 1024];
const DEFAULT_MEMORY_CEILING_MIB = 2048;

type GuestArch = "amd64" | "arm64";
type BenchSuite = "core" | "mount" | "net";

interface Args {
  n: number;
  guestArch: GuestArch;
  json?: string;
  jsonDir?: string;
  cpuBytesMib: number;
  memorySizesMib: number[];
  memoryCeilingMib: number;
  suites: BenchSuite[];
  skipLatency: boolean;
  skipResources: boolean;
  pooledRootdiskCache: boolean;
  environment: BenchmarkEnvironment;
}

interface AssetPaths {
  guestArch: GuestArch;
  kernel: string;
  dtb?: string;
  image: string;
}

interface PhaseLine {
  kind: string;
  total: number;
  phases: Map<string, number>;
  rootdiskCopies?: RootdiskCopyEvent[];
}

interface Stats {
  n: number;
  min: number;
  avg: number;
  med: number;
  p95: number;
  max: number;
  sum: number;
}

interface SnapshotSample {
  engine: string;
  elapsedMs: number;
  wallMs: number;
  bundleApparentBytes: number;
  bundleAllocatedBytes: number;
  phases: Map<string, number>;
  sourcePauseMs: number | null;
  sourcePauseNote: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type BenchOption =
  | "n"
  | "guestArch"
  | "json"
  | "jsonDir"
  | "cpuBytesMib"
  | "memorySizesMib"
  | "memoryCeilingMib"
  | "suite"
  | "skipLatency"
  | "skipResources"
  | "pooledRootdiskCache"
  | "environment"
  | "help";

type BenchOptionHandler = (out: Args, value: string | undefined) => void;

const VALUE_OPTIONS = new Map<string, BenchOption>([
  ["--n", "n"],
  ["-n", "n"],
  ["--guest-arch", "guestArch"],
  ["--json", "json"],
  ["--json-dir", "jsonDir"],
  ["--cpu-bytes-mib", "cpuBytesMib"],
  ["--memory-sizes", "memorySizesMib"],
  ["--memory-ceiling", "memoryCeilingMib"],
  ["--suite", "suite"],
  ["--environment", "environment"],
]);
const BARE_OPTIONS = new Map<string, BenchOption>([
  ["--skip-latency", "skipLatency"],
  ["--skip-resources", "skipResources"],
  ["--pooled-rootdisk-cache", "pooledRootdiskCache"],
  ["-h", "help"],
  ["--help", "help"],
]);
const OPTION_HANDLERS: Record<BenchOption, BenchOptionHandler> = {
  n: (out, value) => (out.n = positiveInteger("--n", value)),
  guestArch: (out, value) => (out.guestArch = parseGuestArch(value)),
  json: (out, value) => (out.json = requiredValue("--json", value)),
  jsonDir: (out, value) => (out.jsonDir = requiredValue("--json-dir", value)),
  cpuBytesMib: (out, value) => (out.cpuBytesMib = positiveInteger("--cpu-bytes-mib", value)),
  memorySizesMib: (out, value) => (out.memorySizesMib = parseMemorySizes(value)),
  memoryCeilingMib: (out, value) =>
    (out.memoryCeilingMib = positiveInteger("--memory-ceiling", value)),
  suite: (out, value) => (out.suites = parseSuites(value)),
  skipLatency: (out) => (out.skipLatency = true),
  skipResources: (out) => (out.skipResources = true),
  pooledRootdiskCache: (out) => (out.pooledRootdiskCache = true),
  environment: (out, value) => (out.environment = parseBenchmarkEnvironment(value)),
  help: () => printUsageAndExit(0),
};

function parseArgs(): Args {
  const out: Args = {
    n: 5,
    guestArch: defaultGuestArch(),
    cpuBytesMib: DEFAULT_CPU_BYTES_MIB,
    memorySizesMib: DEFAULT_MEMORY_SIZES_MIB,
    memoryCeilingMib: DEFAULT_MEMORY_CEILING_MIB,
    suites: ["core", "mount", "net"],
    skipLatency: false,
    skipResources: false,
    pooledRootdiskCache: false,
    environment: "disk",
  };
  parseOptions(process.argv.slice(2), out);
  validateArgs(out);
  return out;
}

// fallow-ignore-next-line complexity
function parseOptions(argv: string[], out: Args): void {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--") {
      continue;
    }
    const parsed = splitOption(argv[i]!);
    const valueOption = VALUE_OPTIONS.get(parsed.key);
    if (valueOption) {
      const { value, nextIndex } = optionValue(argv, i, parsed);
      OPTION_HANDLERS[valueOption](out, value);
      i = nextIndex;
      continue;
    }
    if (runBareOption(out, parsed)) {
      continue;
    }
    rejectArg(argv[i]!);
  }
}

function splitOption(arg: string): { key: string; hasInlineValue: boolean; value?: string } {
  const eq = arg.indexOf("=");
  if (eq === -1) {
    return { key: arg, hasInlineValue: false };
  }
  return { key: arg.slice(0, eq), hasInlineValue: true, value: arg.slice(eq + 1) };
}

function optionValue(
  argv: string[],
  index: number,
  parsed: { key: string; hasInlineValue: boolean; value?: string },
): { value: string | undefined; nextIndex: number } {
  if (parsed.hasInlineValue) {
    return { value: parsed.value, nextIndex: index };
  }
  if (argv[index + 1] === undefined) {
    console.error(`bench: ${parsed.key} requires a value`);
    process.exit(2);
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function runBareOption(out: Args, parsed: { key: string; hasInlineValue: boolean }): boolean {
  if (parsed.hasInlineValue) {
    return false;
  }
  const option = BARE_OPTIONS.get(parsed.key);
  if (!option) {
    return false;
  }
  OPTION_HANDLERS[option](out, undefined);
  return true;
}

function rejectArg(arg: string): never {
  console.error(`bench: unknown arg ${arg}`);
  printUsageAndExit(2);
}

function printUsageAndExit(code: number): never {
  console.log(
    "usage: bench [--n N=5] [--suite all|core|mount|net] [--guest-arch amd64|arm64] " +
      "[--json PATH|--json-dir DIR] [--cpu-bytes-mib MIB] [--memory-sizes 128,512,1024] " +
      "[--memory-ceiling MIB] [--skip-latency] [--skip-resources] [--pooled-rootdisk-cache] " +
      "[--environment disk|ramdisk]",
  );
  process.exit(code);
}

// fallow-ignore-next-line complexity
function validateArgs(out: Args): void {
  if (out.skipLatency && out.skipResources && out.suites.every((suite) => suite === "core")) {
    console.error("bench: --skip-latency and --skip-resources leave nothing to run");
    process.exit(2);
  }
  const maxTouch = Math.max(...out.memorySizesMib);
  if (maxTouch >= out.memoryCeilingMib) {
    console.error(
      `bench: --memory-ceiling (${out.memoryCeilingMib}) must be greater than max --memory-sizes (${maxTouch})`,
    );
    process.exit(2);
  }
}

function requiredValue(flag: string, value: string | undefined): string {
  if (!value) {
    console.error(`bench: ${flag} requires a non-empty value`);
    process.exit(2);
  }
  return value;
}

// fallow-ignore-next-line complexity
function positiveInteger(flag: string, value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(n) || n < 1 || String(n) !== value) {
    console.error(`bench: ${flag} must be a positive integer (got ${value})`);
    process.exit(2);
  }
  return n;
}

function parseMemorySizes(value: string | undefined): number[] {
  const spec = requiredValue("--memory-sizes", value);
  const sizes = spec.split(",").map((part) => positiveInteger("--memory-sizes", part));
  if (sizes.length === 0) {
    console.error("bench: --memory-sizes must contain at least one size");
    process.exit(2);
  }
  return sizes;
}

// fallow-ignore-next-line complexity
function parseSuites(value: string | undefined): BenchSuite[] {
  const spec = requiredValue("--suite", value);
  const suites = new Set<BenchSuite>();
  for (const raw of spec.split(",")) {
    const suite = raw.trim();
    if (suite === "all") {
      suites.add("core");
      suites.add("mount");
      suites.add("net");
      continue;
    }
    if (suite === "core" || suite === "mount" || suite === "net") {
      suites.add(suite);
      continue;
    }
    console.error(`bench: --suite must be all, core, mount, or net (got ${raw})`);
    process.exit(2);
  }
  if (suites.size === 0) {
    console.error("bench: --suite must select at least one suite");
    process.exit(2);
  }
  return [...suites];
}

function defaultGuestArch(): GuestArch {
  const override = process.env.MACHINEN_GUEST_ARCH;
  if (override === "amd64" || override === "arm64") {
    return override;
  }
  return hostArch() === "x64" ? "amd64" : "arm64";
}

function parseGuestArch(value: string | undefined): GuestArch {
  if (value === "amd64" || value === "arm64") {
    return value;
  }
  console.error(`bench: --guest-arch must be amd64 or arm64 (got ${value})`);
  process.exit(2);
}

function resolveAssets(guestArch: GuestArch): AssetPaths {
  const fallback = join(homedir(), ".machinen", "runtime-v0.0.0", "bases", `debian-${guestArch}`);
  if (guestArch === "amd64") {
    return {
      guestArch,
      kernel: pickFirstExisting([join(ASSETS, "bzImage-x86_64"), join(fallback, "Image")]),
      image: pickFirstExisting([
        join(ASSETS, "rootfs-debian-amd64.tar.gz"),
        join(fallback, "rootfs.tar.gz"),
      ]),
    };
  }
  return {
    guestArch,
    kernel: pickFirstExisting([join(ASSETS, "Image-arm64"), join(fallback, "Image")]),
    dtb: pickFirstExisting([join(ASSETS, "virt-arm64.dtb"), join(fallback, "virt.dtb")]),
    image: pickFirstExisting([
      join(ASSETS, "rootfs-debian-arm64.tar.gz"),
      join(fallback, "rootfs.tar.gz"),
    ]),
  };
}

function pickFirstExisting(candidates: string[]): string {
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return candidates[0]!;
}

function requireAssets(assets: AssetPaths): void {
  for (const p of [assets.kernel, assets.dtb, assets.image]) {
    if (p && !existsSync(p)) {
      console.error(
        `bench: missing fixture ${p}. Run scripts/build-base-assets.sh + pnpm provision.`,
      );
      process.exit(2);
    }
  }
}

function clearRootfsImgCache(): void {
  if (existsSync(ROOTFS_IMG_CACHE)) {
    rmSync(ROOTFS_IMG_CACHE, { recursive: true, force: true });
  }
  mkdirSync(ROOTFS_IMG_CACHE, { recursive: true });
}

function clearRootfsImgCacheForColdSample(args: Args): void {
  if (!args.pooledRootdiskCache) {
    clearRootfsImgCache();
  }
}

async function prewarmRootfsImgCacheIfNeeded(args: Args, assets: AssetPaths): Promise<void> {
  if (!args.pooledRootdiskCache) {
    return;
  }
  process.stderr.write(`[rootdisk-cache] prewarming ${assets.image}\n`);
  const { ensureRootfsImage, markRootfsImageClean } = await loadRuntime();
  const img = ensureRootfsImage(assets.image);
  markRootfsImageClean(img);
}

function phaseLineTail(line: string): string | undefined {
  const idx = line.indexOf("phases ");
  if (idx < 0) {
    return undefined;
  }
  return line.slice(idx + "phases ".length).trim();
}

// fallow-ignore-next-line complexity
function parsePhaseLine(line: string): PhaseLine | null {
  const tail = phaseLineTail(line);
  if (tail === undefined) {
    return null;
  }
  const state: PhaseLine = { kind: "", total: -1, phases: new Map<string, number>() };
  for (const token of tail.split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq < 0) {
      return null;
    }
    const key = token.slice(0, eq);
    const value = token.slice(eq + 1);
    if (key === "kind") {
      state.kind = value;
    } else if (key === "total") {
      state.total = Number.parseInt(value, 10);
    } else {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) {
        state.phases.set(key, n);
      }
    }
  }
  return state.kind && state.total >= 0 ? state : null;
}

async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; captured: string }> {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  (process.stderr as { write: typeof orig }).write = ((
    chunk: string | Uint8Array,
    encOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ) => {
    const s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    lines.push(s);
    return orig(chunk as Buffer, encOrCb as BufferEncoding, cb);
  }) as typeof orig;
  try {
    return { result: await fn(), captured: lines.join("") };
  } finally {
    (process.stderr as { write: typeof orig }).write = orig;
  }
}

async function runOneBoot(assets: AssetPaths, label: string): Promise<PhaseLine> {
  const { captured } = await captureStderr(async () => {
    process.stderr.write(`[${label}] booting...\n`);
    const { boot } = await loadRuntime();
    const vm = await boot({
      image: assets.image,
      kernel: assets.kernel,
      dtb: assets.dtb,
      cmd: ["/bin/true"],
      timeoutMs: 60_000,
    });
    await Promise.race([
      new Promise<void>((res) => {
        vm.stderr.once("data", () => res());
      }),
      vm.wait().then(
        () => undefined,
        () => undefined,
      ),
    ]);
    await vm.kill().catch(() => {});
    await vm.wait().catch(() => undefined);
  });
  const rootdiskCopies = parseRootdiskCopyEvents(captured);
  for (const line of captured.split("\n").reverse()) {
    const parsed = parsePhaseLine(line);
    if (parsed?.kind === "boot") {
      parsed.rootdiskCopies = rootdiskCopies;
      return parsed;
    }
  }
  throw new Error(`bench: no machinen:boot phases line captured in ${label}`);
}

async function runOneRestore(
  assets: AssetPaths,
  snapDir: string,
  label: string,
): Promise<PhaseLine[]> {
  let restoreWallMs = 0;
  const { captured } = await captureStderr(async () => {
    process.stderr.write(`[${label}] restoring...\n`);
    const { restore } = await loadRuntime();
    const start = process.hrtime.bigint();
    const vm = await restore({
      snapDir,
      image: assets.image,
      kernel: assets.kernel,
      dtb: assets.dtb,
    });
    restoreWallMs = elapsedSinceMs(start);
    // restore() has already completed the runtime readiness path. Do not wait
    // for another stderr byte here: the first guest byte usually arrived before
    // the handle was returned, and waiting would turn a benchmark into a 60s
    // timeout probe.
    await delay(250);
    await vm.kill().catch(() => {});
    await vm.wait().catch(() => undefined);
  });
  const lines = bootOrRestorePhaseLines(captured);
  attachRootdiskCopyEvents(lines, captured);
  lines.push(syntheticRestorePhase(restoreWallMs, lines, captured));
  return lines;
}

function bootOrRestorePhaseLines(captured: string): PhaseLine[] {
  return phaseLinesForKinds(captured, new Set(["boot", "restore"]));
}

function attachRootdiskCopyEvents(lines: PhaseLine[], captured: string): void {
  const rootdiskCopies = parseRootdiskCopyEvents(captured);
  if (rootdiskCopies.length === 0) {
    return;
  }
  const boot = lines.find((line) => line.kind === "boot");
  if (boot) {
    boot.rootdiskCopies = rootdiskCopies;
  }
}

function phaseLinesForKinds(captured: string, kinds: Set<string>): PhaseLine[] {
  const found: PhaseLine[] = [];
  for (const line of captured.split("\n")) {
    const parsed = parsePhaseLine(line);
    if (parsed && kinds.has(parsed.kind)) {
      found.push(parsed);
    }
  }
  return found;
}

function syntheticRestorePhase(wallMs: number, lines: PhaseLine[], captured: string): PhaseLine {
  const phases = new Map<string, number>();
  const boot = [...lines].reverse().find((line) => line.kind === "boot");
  if (boot) {
    phases.set("boot-to-first-guest-byte", boot.total);
  }
  const vmstateApply = parseVmstateRestoreTotal(captured);
  if (vmstateApply !== undefined) {
    phases.set("vmstate-apply", vmstateApply);
  }
  return { kind: "restore", total: Math.round(wallMs), phases };
}

function parseVmstateRestoreTotal(captured: string): number | undefined {
  const lines = captured.split("\n").reverse();
  for (const line of lines) {
    const match = /vmstate restore timing .*event=done total_ms=(\d+)/.exec(line);
    if (match?.[1]) {
      return Number.parseInt(match[1], 10);
    }
  }
  return undefined;
}

function freshSnapshotDir(index: number): string {
  const snapDir = join(tmpdir(), `bench-snap-${process.pid}-${index}`);
  cleanupSnapshotDir(snapDir);
  return snapDir;
}

async function takeSnapshot(
  assets: AssetPaths,
  index: number,
): Promise<{ snapDir: string; sample: SnapshotSample }> {
  const snapDir = freshSnapshotDir(index);
  process.stderr.write(`[snapshot-source-${index}] booting + dumping into ${snapDir}\n`);
  const { boot } = await loadRuntime();
  const vm = await boot({
    image: assets.image,
    kernel: assets.kernel,
    dtb: assets.dtb,
    cmd: ["/bin/sh", "-c", "while :; do sleep 1; done"],
    timeoutMs: 60_000,
  });
  try {
    await delay(1500);
    const start = process.hrtime.bigint();
    const snapshot = await captureStderr(() => vm.snapshot({ outDir: snapDir, timeoutMs: 60_000 }));
    const result = snapshot.result;
    const wallMs = elapsedSinceMs(start);
    const snapshotPhases = phaseLinesForKinds(snapshot.captured, new Set(["snapshot"])).at(-1);
    const size = bundleSize(snapDir);
    return {
      snapDir,
      sample: {
        engine: result.engine,
        elapsedMs: result.elapsedMs,
        wallMs,
        bundleApparentBytes: size.apparentBytes,
        bundleAllocatedBytes: size.allocatedBytes,
        phases: snapshotPhases?.phases ?? new Map<string, number>(),
        sourcePauseMs: null,
        sourcePauseNote:
          "not separately exposed by runtime yet; vmstate source is paused during the SIGUSR1/SIGUSR2 snapshot critical section",
      },
    };
  } catch (err) {
    cleanupSnapshotDir(snapDir);
    throw err;
  } finally {
    await vm.kill().catch(() => {});
    await vm.wait().catch(() => undefined);
  }
}

// fallow-ignore-next-line complexity
async function runLatencyBench(args: Args, assets: AssetPaths): Promise<JsonValue> {
  await prewarmRootfsImgCacheIfNeeded(args, assets);
  const bootCold: PhaseLine[] = [];
  const bootWarm: PhaseLine[] = [];
  for (let i = 0; i < args.n; i++) {
    clearRootfsImgCacheForColdSample(args);
    bootCold.push(await runOneBoot(assets, `boot-cold-${i + 1}`));
  }
  for (let i = 0; i < args.n; i++) {
    bootWarm.push(await runOneBoot(assets, `boot-warm-${i + 1}`));
  }

  const snapDirs: string[] = [];
  const snapshots: SnapshotSample[] = [];
  const restoreCold: PhaseLine[] = [];
  const restoreWarm: PhaseLine[] = [];
  try {
    for (let i = 0; i < args.n; i++) {
      const snapshot = await takeSnapshot(assets, i + 1);
      snapDirs.push(snapshot.snapDir);
      assertSnapshotBundle(snapshot.snapDir);
      snapshots.push(snapshot.sample);
      if (i > 0) {
        cleanupSnapshotDir(snapshot.snapDir);
        snapDirs.pop();
      }
    }
    const restoreSnapDir = snapDirs[0];
    if (!restoreSnapDir) {
      throw new Error("bench: no snapshot produced for restore benchmark");
    }
    for (let i = 0; i < args.n; i++) {
      clearRootfsImgCacheForColdSample(args);
      collectRestorePhase(
        restoreCold,
        await runOneRestore(assets, restoreSnapDir, `restore-cold-${i + 1}`),
      );
    }
    for (let i = 0; i < args.n; i++) {
      collectRestorePhase(
        restoreWarm,
        await runOneRestore(assets, restoreSnapDir, `restore-warm-${i + 1}`),
      );
    }
  } finally {
    for (const snapDir of snapDirs) {
      cleanupSnapshotDir(snapDir);
    }
  }

  printAggregate("BOOT (cold)", bootCold);
  printAggregate("BOOT (warm)", bootWarm);
  printSnapshotSummary(snapshots);
  printAggregate("RESTORE (cold)", restoreCold);
  printAggregate("RESTORE (warm)", restoreWarm);

  return {
    boot_cold: suiteJson(bootCold),
    boot_warm: suiteJson(bootWarm),
    snapshot: snapshotSuiteJson(snapshots),
    restore_cold: suiteJson(restoreCold),
    restore_warm: suiteJson(restoreWarm),
  };
}

function assertSnapshotBundle(snapDir: string): void {
  if (existsSync(join(snapDir, "meta.json"))) {
    return;
  }
  throw new Error(`takeSnapshot did not produce ${snapDir}/meta.json`);
}

function collectRestorePhase(out: PhaseLine[], lines: PhaseLine[]): void {
  const restores = lines.filter((line) => line.kind === "restore");
  if (restores.length === 0) {
    return;
  }
  const merged = new Map<string, number>();
  mergeRestoreBootPhases(merged, lines);
  for (const restore of restores) {
    for (const [key, value] of restore.phases) {
      merged.set(key, value);
    }
  }
  out.push({
    kind: "restore",
    total: restores.at(-1)!.total,
    phases: merged,
    rootdiskCopies: lines.flatMap((line) => line.rootdiskCopies ?? []),
  });
}

function mergeRestoreBootPhases(merged: Map<string, number>, lines: PhaseLine[]): void {
  for (const boot of lines.filter((line) => line.kind === "boot")) {
    merged.set("boot.total", boot.total);
    for (const [key, value] of boot.phases) {
      merged.set(`boot.${key}`, value);
    }
  }
}

function snapshotSuiteJson(samples: SnapshotSample[]): JsonValue {
  return {
    aggregates: {
      elapsed_ms: stats(samples.map((sample) => sample.elapsedMs)) as unknown as JsonValue,
      wall_ms: stats(samples.map((sample) => sample.wallMs)) as unknown as JsonValue,
      bundle_apparent_bytes: stats(
        samples.map((sample) => sample.bundleApparentBytes),
      ) as unknown as JsonValue,
      bundle_allocated_bytes: stats(
        samples.map((sample) => sample.bundleAllocatedBytes),
      ) as unknown as JsonValue,
    },
    phases: aggregateJson(snapshotPhaseLines(samples)),
    source_pause_ms: null,
    source_pause_note:
      "not separately exposed by runtime yet; vmstate source is paused during the SIGUSR1/SIGUSR2 snapshot critical section",
  };
}

function printSnapshotSummary(samples: SnapshotSample[]): void {
  if (samples.length === 0) {
    console.log("\n=== SNAPSHOT (no runs) ===");
    return;
  }
  console.log(`\n=== SNAPSHOT (n=${samples.length}) ===`);
  console.log(`  ${"metric".padEnd(28)}  min   avg   med   p95   max`);
  printSnapshotRow("elapsed", stats(samples.map((sample) => sample.elapsedMs)), "ms");
  printSnapshotRow("wall", stats(samples.map((sample) => sample.wallMs)), "ms");
  printSnapshotRow(
    "bundle apparent",
    stats(samples.map((sample) => sample.bundleApparentBytes / 1024 / 1024)),
    "MiB",
  );
  printSnapshotRow(
    "bundle allocated",
    stats(samples.map((sample) => sample.bundleAllocatedBytes / 1024 / 1024)),
    "MiB",
  );
  for (const key of phaseKeys(snapshotPhaseLines(samples))) {
    if (key === "total") {
      continue;
    }
    printSnapshotRow(
      key,
      stats(snapshotPhaseLines(samples).map((sample) => sample.phases.get(key) ?? 0)),
      "ms",
    );
  }
}

function snapshotPhaseLines(samples: SnapshotSample[]): PhaseLine[] {
  return samples.map((sample) => ({
    kind: "snapshot",
    total: Math.round(sample.elapsedMs),
    phases: sample.phases,
  }));
}

function printSnapshotRow(label: string, row: Stats, unit: string): void {
  console.log(
    `  ${label.padEnd(28)}  ${row.min.toFixed(1).padStart(4)}  ${row.avg.toFixed(1).padStart(4)}  ${row.med.toFixed(1).padStart(4)}  ${row.p95.toFixed(1).padStart(4)}  ${row.max.toFixed(1).padStart(4)} ${unit}`,
  );
}

function bundleSize(path: string): { apparentBytes: number; allocatedBytes: number } {
  const st = statSync(path);
  const ownAllocated = ((st as { blocks?: number }).blocks ?? Math.ceil(st.size / 512)) * 512;
  if (!st.isDirectory()) {
    return { apparentBytes: st.size, allocatedBytes: ownAllocated };
  }
  let apparentBytes = st.size;
  let allocatedBytes = ownAllocated;
  for (const entry of readdirSync(path)) {
    const child = bundleSize(join(path, entry));
    apparentBytes += child.apparentBytes;
    allocatedBytes += child.allocatedBytes;
  }
  return { apparentBytes, allocatedBytes };
}

function suiteJson(runs: PhaseLine[]): JsonValue {
  const out: { [key: string]: JsonValue } = {
    aggregates: aggregateJson(runs),
  };
  const rootdiskCopy = rootdiskCopyJson(runs.flatMap((run) => run.rootdiskCopies ?? []));
  if (rootdiskCopy) {
    out.rootdisk_copy = rootdiskCopy;
  }
  return out;
}

function aggregateJson(runs: PhaseLine[]): JsonValue {
  const out: { [key: string]: JsonValue } = {};
  for (const key of phaseKeys(runs)) {
    const samples = samplesForPhase(key, runs);
    if (samples.length > 0) {
      out[key] = stats(samples) as unknown as JsonValue;
    }
  }
  return out;
}

function phaseKeys(runs: PhaseLine[]): string[] {
  const keys: string[] = ["total"];
  const seen = new Set<string>(["total"]);
  for (const run of runs) {
    for (const key of run.phases.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        keys.push(key);
      }
    }
  }
  return keys;
}

function samplesForPhase(key: string, runs: PhaseLine[]): number[] {
  const samples: number[] = [];
  for (const run of runs) {
    const value = key === "total" ? run.total : run.phases.get(key);
    if (typeof value === "number") {
      samples.push(value);
    }
  }
  return samples;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const med = sampleAt(sorted, Math.floor(n / 2));
  const p95 = sampleAt(sorted, Math.min(n - 1, Math.floor(n * 0.95)));
  const sum = sorted.reduce((s, x) => s + x, 0);
  const avg = n === 0 ? 0 : sum / n;
  return { n, min: sampleAt(sorted, 0), avg, med, p95, max: sampleAt(sorted, n - 1), sum };
}

function sampleAt(samples: number[], index: number): number {
  return samples[index] ?? 0;
}

function printAggregate(label: string, runs: PhaseLine[]): void {
  if (runs.length === 0) {
    console.log(`\n=== ${label} (no runs) ===`);
    return;
  }
  console.log(`\n=== ${label} (n=${runs.length}) ===`);
  console.log(`  ${"phase".padEnd(28)}  min   avg   med   p95   max  (ms)`);
  for (const key of phaseKeys(runs)) {
    const samples = samplesForPhase(key, runs);
    if (samples.length === 0) {
      continue;
    }
    const row = stats(samples);
    console.log(
      `  ${key.padEnd(28)}  ${String(Math.round(row.min)).padStart(4)}  ${String(Math.round(row.avg)).padStart(4)}  ${String(Math.round(row.med)).padStart(4)}  ${String(Math.round(row.p95)).padStart(4)}  ${String(Math.round(row.max)).padStart(4)}`,
    );
  }
}

function elapsedSinceMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function cleanupSnapshotDir(snapDir: string | undefined): void {
  if (!snapDir || !existsSync(snapDir)) {
    return;
  }
  try {
    rmSync(snapDir, { recursive: true, force: true });
  } catch {}
}

function buildResultPath(args: Args, commit: string): string | undefined {
  if (args.json) {
    return args.json;
  }
  if (!args.jsonDir) {
    return undefined;
  }
  const safeCommit = commit || "unknown";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(args.jsonDir, safeCommit, `bench-${stamp}.json`);
}

function writeJsonResult(path: string, result: JsonValue): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`\nwrote ${path}`);
}

function gitOutput(args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

function gitMetadata(): JsonValue {
  const commit = gitOutput(["rev-parse", "HEAD"]);
  const branch = gitOutput(["branch", "--show-current"]);
  const status = gitOutput(["status", "--short"]);
  return { commit, branch, dirty: Boolean(status) };
}

function shouldRunSuite(args: Args, suite: BenchSuite): boolean {
  return args.suites.includes(suite);
}

// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const args = parseArgs();
  const assets = resolveAssets(args.guestArch);
  requireAssets(assets);
  const git = gitMetadata();
  const commit = typeof git === "object" && git && "commit" in git ? String(git.commit ?? "") : "";
  const out = buildResultPath(args, commit);
  const filesystems = filesystemMetadata({
    repoRoot: REPO_ROOT,
    assets: ASSETS,
    rootfsImgCache: ROOTFS_IMG_CACHE,
    outputPath: out,
  });
  validateBenchmarkEnvironment(args.environment, filesystems);
  const result: { [key: string]: JsonValue } = {
    schema_version: 1,
    benchmark: "bench",
    generated_at: new Date().toISOString(),
    git,
    host: hostMetadata(),
    filesystems,
    assets: assetMetadata(assets),
    config: {
      n: args.n,
      suites: args.suites,
      cpu_bytes_mib: args.cpuBytesMib,
      memory_sizes_mib: args.memorySizesMib,
      memory_ceiling_mib: args.memoryCeilingMib,
      pooled_rootdisk_cache: args.pooledRootdiskCache,
      environment: args.environment,
    },
  };
  if (shouldRunSuite(args, "core")) {
    if (!args.skipLatency) {
      result.latency = await runLatencyBench(args, assets);
    }
    if (!args.skipResources) {
      result.resources = await runResourceBench(args, assets);
    }
  }
  if (shouldRunSuite(args, "mount")) {
    result.mount = runMountBenchSuite(args, REPO_ROOT);
  }
  if (shouldRunSuite(args, "net")) {
    result.net = runNetBenchSuite(args, REPO_ROOT);
  }
  if (out) {
    writeJsonResult(out, result);
  } else {
    console.log("\nJSON result:");
    console.log(JSON.stringify(result, null, 2));
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("bench failed:", err instanceof Error ? err.stack || err.message : err);
    process.exit(3);
  },
);
