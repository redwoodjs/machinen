// #221 — Boot/restore phase-latency bench.
//
// Boots a microVM N times in a row, captures each run's structured
// `phases` line (DEBUG=machinen:boot), and prints a per-phase table
// (n / min / median / p95 / max / sum) so before/after numbers are
// straightforward to diff.
//
// Two modes:
//   --mode=boot     N cold + N warm boots (default)
//   --mode=restore  produce one snapshot, then N restore() runs
//
// Cold vs warm:
//   "Cold" wipes the rootfs-img materialization cache
//   (`~/.cache/machinen/rootfs/<sha>.img`) before each iteration so
//   `rootdisk-materialize` pays the full mke2fs price. "Warm" leaves
//   it in place and the same iteration shows reflink-clone-only cost.
//   gvproxy install / initramfs-pack are NOT cleared: their per-boot
//   cost is what we want to measure here.
//
// Usage:
//   pnpm bench-boot                       # 5 cold + 5 warm boots
//   pnpm bench-boot --n 3                 # 3 + 3
//   pnpm bench-boot --mode=restore --n 3  # snapshot once, restore x3 (cold+warm)
//   pnpm bench-boot --warm-only           # skip the cold pass
//   pnpm bench-boot --cold-only           # skip the warm pass
//
// Exit codes: 0 success. 2 missing fixtures / args. 3 a run failed.
//
// Output:
//   - Each iteration prints "[run-iN] phases ..." (the structured line).
//   - The final summary table is plain text, easy to paste into the
//     issue thread.

// `debug` snapshots the DEBUG envvar at import time, so we set it
// BEFORE pulling in @machinen/runtime — which eagerly creates
// `debugLib("machinen:boot")` instances at module load. ESM hoists
// static imports above any top-level statements, so the runtime
// import has to be dynamic (inside main()) for our env tweak to land
// before the namespace caches enabled-state.
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RuntimeMod = typeof import("@machinen/runtime");
let runtime: RuntimeMod | undefined;
async function loadRuntime(): Promise<RuntimeMod> {
  if (!runtime) {
    process.env.DEBUG = (process.env.DEBUG ?? "") + ",machinen:boot,machinen:restore";
    runtime = await import("@machinen/runtime");
  }
  return runtime;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ASSETS = join(REPO_ROOT, "release-assets");
// Fallback to the runtime asset cache (~/.machinen/runtime-vX/bases/<base>)
// so bench-boot works on a checkout that hasn't run scripts/build-base-assets.sh.
const FALLBACK_BASE = join(homedir(), ".machinen", "runtime-v0.0.0", "bases", "debian-arm64");
const KERNEL = pickFirstExisting([join(ASSETS, "Image-arm64"), join(FALLBACK_BASE, "Image")]);
const DTB = pickFirstExisting([join(ASSETS, "virt-arm64.dtb"), join(FALLBACK_BASE, "virt.dtb")]);
const IMAGE = pickFirstExisting([
  join(ASSETS, "rootfs-debian-arm64.tar.gz"),
  join(FALLBACK_BASE, "rootfs.tar.gz"),
]);
const ROOTFS_IMG_CACHE = join(homedir(), ".cache", "machinen", "rootfs");

function pickFirstExisting(candidates: string[]): string {
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return candidates[0]!;
}

type Mode = "boot" | "restore";

interface Args {
  n: number;
  mode: Mode;
  coldOnly: boolean;
  warmOnly: boolean;
}

type BenchOption = "n" | "mode" | "coldOnly" | "warmOnly" | "help";

type BenchOptionHandler = (out: Args, value: string | undefined) => void;

const BENCH_VALUE_OPTIONS = new Map<string, BenchOption>([
  ["--n", "n"],
  ["-n", "n"],
  ["--mode", "mode"],
]);
const BENCH_BARE_OPTIONS = new Map<string, BenchOption>([
  ["--cold-only", "coldOnly"],
  ["--warm-only", "warmOnly"],
  ["-h", "help"],
  ["--help", "help"],
]);
const BENCH_OPTION_HANDLERS: Record<BenchOption, BenchOptionHandler> = {
  n: (out, value) => (out.n = Number.parseInt(value ?? "", 10)),
  mode: (out, value) => (out.mode = value as Mode),
  coldOnly: (out) => (out.coldOnly = true),
  warmOnly: (out) => (out.warmOnly = true),
  help: () => printUsageAndExit(0),
};

function parseArgs(): Args {
  const out: Args = { n: 5, mode: "boot", coldOnly: false, warmOnly: false };
  parseBenchOptions(process.argv.slice(2), out);
  validateBenchArgs(out);
  return out;
}

function parseBenchOptions(argv: string[], out: Args): void {
  for (let i = 0; i < argv.length; i++) {
    const parsed = splitBenchOption(argv[i]!);
    const valueOption = BENCH_VALUE_OPTIONS.get(parsed.key);
    if (valueOption) {
      const { value, nextIndex } = benchOptionValue(argv, i, parsed);
      BENCH_OPTION_HANDLERS[valueOption](out, value);
      i = nextIndex;
      continue;
    }
    if (runBareBenchOption(out, parsed)) {
      continue;
    }
    rejectBenchArg(argv[i]!);
  }
}

function splitBenchOption(arg: string): { key: string; hasInlineValue: boolean; value?: string } {
  const eq = arg.indexOf("=");
  if (eq === -1) {
    return { key: arg, hasInlineValue: false };
  }
  return { key: arg.slice(0, eq), hasInlineValue: true, value: arg.slice(eq + 1) };
}

function benchOptionValue(
  argv: string[],
  index: number,
  parsed: { hasInlineValue: boolean; value?: string },
): { value: string | undefined; nextIndex: number } {
  if (parsed.hasInlineValue) {
    return { value: parsed.value, nextIndex: index };
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function runBareBenchOption(out: Args, parsed: { key: string; hasInlineValue: boolean }): boolean {
  if (parsed.hasInlineValue) {
    return false;
  }
  const option = BENCH_BARE_OPTIONS.get(parsed.key);
  if (!option) {
    return false;
  }
  BENCH_OPTION_HANDLERS[option](out, undefined);
  return true;
}

function rejectBenchArg(arg: string): never {
  console.error(`bench-boot: unknown arg ${arg}`);
  printUsageAndExit(2);
}

function validateBenchArgs(out: Args): void {
  validateBenchN(out.n);
  validateBenchMode(out.mode);
  validateBenchTemperatureFlags(out);
}

function validateBenchN(n: number): void {
  if (!Number.isInteger(n)) {
    rejectBenchN(n);
  }
  if (n < 1) {
    rejectBenchN(n);
  }
}

function rejectBenchN(n: number): never {
  console.error(`bench-boot: --n must be a positive integer (got ${n})`);
  process.exit(2);
}

function validateBenchMode(mode: Mode): void {
  if (mode === "boot") {
    return;
  }
  if (mode === "restore") {
    return;
  }
  console.error(`bench-boot: --mode must be 'boot' or 'restore' (got ${mode})`);
  process.exit(2);
}

function validateBenchTemperatureFlags(out: Args): void {
  if (!out.coldOnly) {
    return;
  }
  if (!out.warmOnly) {
    return;
  }
  console.error("bench-boot: --cold-only and --warm-only are mutually exclusive");
  process.exit(2);
}

function printUsageAndExit(code: number): never {
  console.log("usage: bench-boot [--n N] [--mode boot|restore] [--cold-only|--warm-only]");
  process.exit(code);
}

function requireAssets(): void {
  for (const p of [KERNEL, DTB, IMAGE]) {
    if (!existsSync(p)) {
      console.error(
        `bench-boot: missing fixture ${p}. Run scripts/build-base-assets.sh + pnpm provision.`,
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

interface PhaseLine {
  kind: string;
  total: number;
  phases: Map<string, number>;
}

/**
 * Parse one "phases kind=X total=Y a=N b=N..." line. Returns null on
 * shape mismatches (e.g. partial line caught mid-flush).
 */
function parsePhaseLine(line: string): PhaseLine | null {
  const tail = phaseLineTail(line);
  if (tail === undefined) {
    return null;
  }
  return parsePhaseTokens(tail.split(/\s+/));
}

function phaseLineTail(line: string): string | undefined {
  const idx = line.indexOf("phases ");
  if (idx < 0) {
    return undefined;
  }
  return line.slice(idx + "phases ".length).trim();
}

function parsePhaseTokens(tokens: string[]): PhaseLine | null {
  const state: PhaseLine = { kind: "", total: -1, phases: new Map<string, number>() };
  for (const token of tokens) {
    const pair = splitPhaseToken(token);
    if (!pair) {
      return null;
    }
    applyPhaseToken(state, pair.key, pair.value);
  }
  if (!phaseLineComplete(state)) {
    return null;
  }
  return state;
}

function splitPhaseToken(token: string): { key: string; value: string } | undefined {
  const eq = token.indexOf("=");
  if (eq < 0) {
    return undefined;
  }
  return { key: token.slice(0, eq), value: token.slice(eq + 1) };
}

function applyPhaseToken(state: PhaseLine, key: string, value: string): void {
  if (key === "kind") {
    state.kind = value;
    return;
  }
  if (key === "total") {
    state.total = Number.parseInt(value, 10);
    return;
  }
  setNumericPhase(state, key, value);
}

function setNumericPhase(state: PhaseLine, key: string, value: string): void {
  const n = Number.parseInt(value, 10);
  if (Number.isFinite(n)) {
    state.phases.set(key, n);
  }
}

function phaseLineComplete(state: PhaseLine): boolean {
  if (!state.kind) {
    return false;
  }
  if (state.total < 0) {
    return false;
  }
  return true;
}

/**
 * Run one boot, wait for first console byte, kill, return the parsed
 * phases line. Picks the line off this process's stderr by attaching
 * a `debug` write listener — the runtime's `debug` writes go to
 * process.stderr, so we tee into a buffer and parse from there.
 */
async function runOneBoot(label: string): Promise<PhaseLine> {
  const lines: string[] = [];
  const orig = process.stderr.write.bind(process.stderr);
  // Tee stderr so we capture the structured line without losing the
  // stream. Cleared in `finally` so a thrown boot doesn't leak the hook.
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
    process.stderr.write(`[${label}] booting...\n`);
    const { boot } = await loadRuntime();
    const vm = await boot({
      image: IMAGE,
      kernel: KERNEL,
      dtb: DTB,
      cmd: ["/bin/true"],
      timeoutMs: 60_000,
    });
    // Wait for first byte (or VMM exit) so the phases line gets
    // flushed before we kill.
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
  } finally {
    (process.stderr as { write: typeof orig }).write = orig;
  }
  const captured = lines.join("");
  for (const ln of captured.split("\n").reverse()) {
    const parsed = parsePhaseLine(ln);
    if (parsed && parsed.kind === "boot") {
      return parsed;
    }
  }
  throw new Error(`bench-boot: no machinen:boot phases line captured in ${label}`);
}

async function runOneRestore(snapDir: string, label: string): Promise<PhaseLine[]> {
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
    process.stderr.write(`[${label}] restoring...\n`);
    const { restore } = await loadRuntime();
    const vm = await restore({ snapDir, image: IMAGE, kernel: KERNEL, dtb: DTB });
    await Promise.race([
      new Promise<void>((res) => {
        vm.stderr.once("data", () => res());
      }),
      vm.wait().then(
        () => undefined,
        () => undefined,
      ),
    ]);
    // Give criu-restore-probe a chance to land its phases line — it's
    // fired from setGuestHostname's vsock round-trip after boot returns.
    await new Promise((res) => setTimeout(res, 250));
    await vm.kill().catch(() => {});
    await vm.wait().catch(() => undefined);
  } finally {
    (process.stderr as { write: typeof orig }).write = orig;
  }
  return bootOrRestorePhaseLines(lines.join(""));
}

function bootOrRestorePhaseLines(captured: string): PhaseLine[] {
  const found: PhaseLine[] = [];
  for (const line of captured.split("\n")) {
    appendBootOrRestorePhase(found, parsePhaseLine(line));
  }
  return found;
}

function appendBootOrRestorePhase(found: PhaseLine[], parsed: PhaseLine | null): void {
  if (!parsed) {
    return;
  }
  if (parsed.kind === "boot") {
    found.push(parsed);
    return;
  }
  if (parsed.kind === "restore") {
    found.push(parsed);
  }
}

async function takeSnapshot(): Promise<string> {
  const snapDir = join(tmpdir(), `bench-boot-snap-${process.pid}`);
  if (existsSync(snapDir)) {
    rmSync(snapDir, { recursive: true, force: true });
  }
  process.stderr.write(`[snapshot-source] booting + dumping into ${snapDir}\n`);
  const { boot } = await loadRuntime();
  // Same workload shape smoke-tests.sh uses for snapshot tests — a
  // /bin/sh busy-loop that idles forever, leaving the VM CRIU-dumpable
  // for as long as the snapshot dispatcher needs.
  const vm = await boot({
    image: IMAGE,
    kernel: KERNEL,
    dtb: DTB,
    cmd: ["/bin/sh", "-c", "while :; do sleep 1; done"],
    timeoutMs: 60_000,
  });
  // Wait for the guest to settle (kernel + supervisor + workload exec)
  // before dispatching the dump. If the source dies before we get there,
  // surface the console tail so the failure is diagnosable.
  vm.wait().then(
    async (res) => {
      if (res.code !== null && res.code !== 0) {
        const tail = (await vm.errorOutput().catch(() => "")) || "<no console output>";
        process.stderr.write(
          `[snapshot-source] VMM exited code=${res.code} signal=${res.signal} before snapshot dispatched.\n` +
            `Console tail (last 4 KiB):\n${tail.slice(-4096)}\n`,
        );
      }
    },
    () => {},
  );
  await new Promise((res) => setTimeout(res, 1500));
  await vm.snapshot({ outDir: snapDir, timeoutMs: 60_000 });
  return snapDir;
}

interface Stats {
  n: number;
  min: number;
  med: number;
  p95: number;
  max: number;
  sum: number;
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  const med = sampleAt(sorted, Math.floor(n / 2));
  const p95 = sampleAt(sorted, Math.min(n - 1, Math.floor(n * 0.95)));
  const sum = sorted.reduce((s, x) => s + x, 0);
  return { n, min: sampleAt(sorted, 0), med, p95, max: sampleAt(sorted, n - 1), sum };
}

function sampleAt(samples: number[], index: number): number {
  const value = samples[index];
  if (value === undefined) {
    return 0;
  }
  return value;
}

function aggregate(label: string, runs: PhaseLine[]): void {
  if (runs.length === 0) {
    console.log(`\n=== ${label} (no runs) ===`);
    return;
  }
  printAggregateHeader(label, runs.length);
  printAggregateRows(phaseKeys(runs), runs);
}

function phaseKeys(runs: PhaseLine[]): string[] {
  // Union of phase keys, in first-run order so the table reads as a timeline.
  const keys: string[] = ["total"];
  const seen = new Set<string>(["total"]);
  for (const run of runs) {
    appendNewPhaseKeys(keys, seen, run);
  }
  return keys;
}

function appendNewPhaseKeys(keys: string[], seen: Set<string>, run: PhaseLine): void {
  for (const key of run.phases.keys()) {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
}

function printAggregateHeader(label: string, count: number): void {
  console.log(`\n=== ${label} (n=${count}) ===`);
  console.log(`  ${"phase".padEnd(28)}  min   med   p95   max  (ms)`);
}

function printAggregateRows(keys: string[], runs: PhaseLine[]): void {
  for (const key of keys) {
    const samples = samplesForPhase(key, runs);
    if (samples.length === 0) {
      continue;
    }
    printAggregateRow(key, stats(samples));
  }
}

function samplesForPhase(key: string, runs: PhaseLine[]): number[] {
  const samples: number[] = [];
  for (const run of runs) {
    const value = phaseValue(run, key);
    if (typeof value === "number") {
      samples.push(value);
    }
  }
  return samples;
}

function phaseValue(run: PhaseLine, key: string): number | undefined {
  if (key === "total") {
    return run.total;
  }
  return run.phases.get(key);
}

function printAggregateRow(key: string, row: Stats): void {
  console.log(
    `  ${key.padEnd(28)}  ${String(row.min).padStart(4)}  ${String(row.med).padStart(4)}  ${String(row.p95).padStart(4)}  ${String(row.max).padStart(4)}`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs();
  requireAssets();
  if (args.mode === "boot") {
    await runBootBench(args);
    return;
  }
  await runRestoreBench(args);
}

async function runBootBench(args: Args): Promise<void> {
  const cold = await collectColdBootRuns(args);
  const warm = await collectWarmBootRuns(args);
  aggregateIfAny("BOOT (cold)", cold);
  aggregateIfAny("BOOT (warm)", warm);
}

async function collectColdBootRuns(args: Args): Promise<PhaseLine[]> {
  const cold: PhaseLine[] = [];
  if (!shouldRunCold(args)) {
    return cold;
  }
  for (let i = 0; i < args.n; i++) {
    clearRootfsImgCache();
    cold.push(await runOneBoot(`cold-${i + 1}`));
  }
  return cold;
}

async function collectWarmBootRuns(args: Args): Promise<PhaseLine[]> {
  const warm: PhaseLine[] = [];
  if (!shouldRunWarm(args)) {
    return warm;
  }
  await primeWarmBootIfNeeded(args);
  for (let i = 0; i < args.n; i++) {
    warm.push(await runOneBoot(`warm-${i + 1}`));
  }
  return warm;
}

async function primeWarmBootIfNeeded(args: Args): Promise<void> {
  // Warm = cache populated. If the cold pass ran, its last boot is our
  // prime. In --warm-only mode, prime explicitly so the first measured
  // warm run isn't accidentally cold.
  if (!args.warmOnly) {
    return;
  }
  await runOneBoot("warm-prime");
}

async function runRestoreBench(args: Args): Promise<void> {
  let snapDir: string | undefined;
  try {
    snapDir = await prepareRestoreSnapshot();
    const cold = await collectColdRestoreRuns(args, snapDir);
    const warm = await collectWarmRestoreRuns(args, snapDir);
    aggregateIfAny("RESTORE (cold)", cold);
    aggregateIfAny("RESTORE (warm)", warm);
  } finally {
    cleanupSnapshotDir(snapDir);
  }
}

async function prepareRestoreSnapshot(): Promise<string> {
  const snapDir = await takeSnapshot();
  if (!existsSync(join(snapDir, "disk.img"))) {
    throw new Error(`takeSnapshot did not produce ${snapDir}/disk.img`);
  }
  return snapDir;
}

async function collectColdRestoreRuns(args: Args, snapDir: string): Promise<PhaseLine[]> {
  const cold: PhaseLine[] = [];
  if (!shouldRunCold(args)) {
    return cold;
  }
  for (let i = 0; i < args.n; i++) {
    clearRootfsImgCache();
    collectRestorePhase(cold, await runOneRestore(snapDir, `cold-${i + 1}`));
  }
  return cold;
}

async function collectWarmRestoreRuns(args: Args, snapDir: string): Promise<PhaseLine[]> {
  const warm: PhaseLine[] = [];
  if (!shouldRunWarm(args)) {
    return warm;
  }
  await primeWarmRestoreIfNeeded(args, snapDir);
  for (let i = 0; i < args.n; i++) {
    collectRestorePhase(warm, await runOneRestore(snapDir, `warm-${i + 1}`));
  }
  return warm;
}

async function primeWarmRestoreIfNeeded(args: Args, snapDir: string): Promise<void> {
  if (!args.warmOnly) {
    return;
  }
  await runOneRestore(snapDir, "warm-prime");
}

function shouldRunCold(args: Args): boolean {
  return !args.warmOnly;
}

function shouldRunWarm(args: Args): boolean {
  return !args.coldOnly;
}

function collectRestorePhase(out: PhaseLine[], lines: PhaseLine[]): void {
  const restore = lines.find((line) => line.kind === "restore");
  if (restore) {
    out.push(restore);
  }
}

function aggregateIfAny(label: string, runs: PhaseLine[]): void {
  if (runs.length) {
    aggregate(label, runs);
  }
}

function cleanupSnapshotDir(snapDir: string | undefined): void {
  if (!snapDir) {
    return;
  }
  if (!existsSync(snapDir)) {
    return;
  }
  try {
    rmSync(snapDir, { recursive: true, force: true });
  } catch {}
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("bench-boot failed:", err instanceof Error ? err.stack || err.message : err);
    process.exit(3);
  },
);
