import { createHash } from "node:crypto";
import type { VmHandle } from "@machinen/runtime";

type RuntimeMod = typeof import("@machinen/runtime");
let runtime: RuntimeMod | undefined;
async function loadRuntime(): Promise<RuntimeMod> {
  if (!runtime) {
    process.env.DEBUG =
      (process.env.DEBUG ?? "") +
      ",machinen:boot,machinen:restore,machinen:snapshot,machinen:vmstate";
    runtime = await import("@machinen/runtime");
  }
  return runtime;
}

export interface ResourceBenchArgs {
  n: number;
  cpuBytesMib: number;
  memorySizesMib: number[];
  memoryCeilingMib: number;
}

export interface ResourceBenchAssets {
  kernel: string;
  dtb?: string;
  image: string;
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

interface CpuSample {
  label: string;
  bytes: number;
  elapsedMs: number;
  throughputBytesPerSec: number;
  exitCode: number;
}

interface CpuSuite {
  aggregate: {
    elapsed_ms: Stats;
    throughput_bytes_per_sec: Stats;
  };
}

interface CpuBenchResult {
  bytes: number;
  host_native: CpuSuite;
  guest_no_quota: CpuSuite;
  guest_quota_1: CpuSuite;
  guest_quota_0_5: CpuSuite;
}

interface MemorySample {
  touchedMib: number;
  stats: {
    ceilingMib: number | null;
    hostRssBytes: number | null;
    balloonReclaimedBytes: number;
    lazyPagesPending: number;
  };
}

interface MemoryTouchAggregate {
  touchedMib: number;
  ceiling_mib: Stats | null;
  host_rss_bytes: Stats | null;
  balloon_reclaimed_bytes: Stats;
  lazy_pages_pending: Stats;
}

interface MemoryBenchResult {
  by_touched_mib: Record<string, MemoryTouchAggregate>;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export async function runResourceBench(
  args: ResourceBenchArgs,
  assets: ResourceBenchAssets,
): Promise<JsonValue> {
  const bytes = args.cpuBytesMib * 1024 * 1024;
  const cpu: CpuBenchResult = {
    bytes,
    host_native: await collectCpuSamples("host-native", args.n, () => runHostCpu(bytes)),
    guest_no_quota: await collectCpuSamples("guest-no-quota", args.n, () =>
      runGuestCpu(assets, args.cpuBytesMib),
    ),
    guest_quota_1: await collectCpuSamples("guest-quota-1", args.n, () =>
      runGuestCpu(assets, args.cpuBytesMib, 1),
    ),
    guest_quota_0_5: await collectCpuSamples("guest-quota-0.5", args.n, () =>
      runGuestCpu(assets, args.cpuBytesMib, 0.5),
    ),
  };
  const memory = await collectMemoryTouchBench(args, assets);
  printCpuSummary(cpu);
  printMemorySummary(memory);
  return { cpu, memory: memory as unknown as JsonValue } as unknown as JsonValue;
}

async function collectCpuSamples(
  label: string,
  n: number,
  run: () => Promise<CpuSample>,
): Promise<CpuSuite> {
  const samples: CpuSample[] = [];
  for (let i = 0; i < n; i++) {
    process.stderr.write(`[cpu:${label}:${i + 1}] running...\n`);
    samples.push(await run());
  }
  return { aggregate: cpuAggregate(samples) };
}

function cpuAggregate(samples: CpuSample[]): CpuSuite["aggregate"] {
  return {
    elapsed_ms: stats(samples.map((sample) => sample.elapsedMs)),
    throughput_bytes_per_sec: stats(samples.map((sample) => sample.throughputBytesPerSec)),
  };
}

async function runHostCpu(bytes: number): Promise<CpuSample> {
  const chunk = Buffer.alloc(1024 * 1024);
  const hash = createHash("sha256");
  const start = process.hrtime.bigint();
  for (let remaining = bytes; remaining > 0; remaining -= chunk.length) {
    hash.update(remaining >= chunk.length ? chunk : chunk.subarray(0, remaining));
  }
  hash.digest("hex");
  const elapsedMs = elapsedSinceMs(start);
  return {
    label: "host-native-node-sha256",
    bytes,
    elapsedMs,
    throughputBytesPerSec: throughput(bytes, elapsedMs),
    exitCode: 0,
  };
}

async function runGuestCpu(
  assets: ResourceBenchAssets,
  bytesMib: number,
  quotaCpus?: number,
): Promise<CpuSample> {
  const vm = await bootIdleVm(assets, { cpu: cpuQuotaOption(quotaCpus) });
  try {
    return await runGuestCpuInVm(vm, bytesMib, quotaCpus);
  } finally {
    await killVm(vm);
  }
}

function cpuQuotaOption(
  quotaCpus: number | undefined,
): { maxVcpus: 1; quotaCpus: number } | undefined {
  return quotaCpus === undefined ? undefined : { maxVcpus: 1, quotaCpus };
}

async function runGuestCpuInVm(
  vm: VmHandle,
  bytesMib: number,
  quotaCpus: number | undefined,
): Promise<CpuSample> {
  const bytes = bytesMib * 1024 * 1024;
  const start = process.hrtime.bigint();
  const res = await vm.execRaw(guestCpuCommand(bytesMib), {
    execTimeoutMs: Math.max(300_000, bytesMib * 2000),
  });
  const elapsedMs = elapsedSinceMs(start);
  assertGuestCpuSuccess(res.exitCode, res.stderr);
  return {
    label: guestCpuLabel(quotaCpus),
    bytes,
    elapsedMs,
    throughputBytesPerSec: throughput(bytes, elapsedMs),
    exitCode: res.exitCode,
  };
}

function guestCpuCommand(bytesMib: number): string {
  return (
    "set -eu; " +
    "command -v sha256sum >/dev/null; " +
    `dd if=/dev/zero bs=1M count=${bytesMib} 2>/tmp/machinen-bench-dd.err | sha256sum >/dev/null`
  );
}

function assertGuestCpuSuccess(exitCode: number, stderr: string): void {
  if (exitCode !== 0) {
    throw new Error(`guest CPU command failed exit=${exitCode} stderr=${stderr || "<empty>"}`);
  }
}

function guestCpuLabel(quotaCpus: number | undefined): string {
  return quotaCpus === undefined ? "guest-sha256" : `guest-sha256-quota-${quotaCpus}`;
}

async function collectMemoryTouchBench(
  args: ResourceBenchArgs,
  assets: ResourceBenchAssets,
): Promise<MemoryBenchResult> {
  const samplesByTouch = new Map<number, MemorySample[]>();
  for (let i = 0; i < args.n; i++) {
    process.stderr.write(`[memory:run-${i + 1}] running...\n`);
    appendMemorySamples(samplesByTouch, await runMemoryTouchOnce(args, assets));
  }
  return { by_touched_mib: aggregateMemoryByTouch(args, samplesByTouch) };
}

function appendMemorySamples(
  samplesByTouch: Map<number, MemorySample[]>,
  samples: MemorySample[],
): void {
  for (const sample of samples) {
    const bucket = samplesByTouch.get(sample.touchedMib) ?? [];
    bucket.push(sample);
    samplesByTouch.set(sample.touchedMib, bucket);
  }
}

function aggregateMemoryByTouch(
  args: ResourceBenchArgs,
  samplesByTouch: Map<number, MemorySample[]>,
): Record<string, MemoryTouchAggregate> {
  const byTouchedMib: Record<string, MemoryTouchAggregate> = {};
  for (const touchedMib of [0, ...args.memorySizesMib]) {
    byTouchedMib[String(touchedMib)] = aggregateMemorySamples(
      touchedMib,
      samplesByTouch.get(touchedMib) ?? [],
    );
  }
  return byTouchedMib;
}

async function runMemoryTouchOnce(
  args: ResourceBenchArgs,
  assets: ResourceBenchAssets,
): Promise<MemorySample[]> {
  const vm = await bootIdleVm(assets, { memoryMib: args.memoryCeilingMib });
  try {
    await mountMemoryTmpfs(vm, Math.max(...args.memorySizesMib) + 128);
    const samples: MemorySample[] = [{ touchedMib: 0, stats: await compactMemoryStats(vm) }];
    for (const sizeMib of args.memorySizesMib) {
      samples.push(await touchMemoryAndSample(vm, sizeMib));
    }
    return samples;
  } finally {
    await killVm(vm);
  }
}

async function mountMemoryTmpfs(vm: VmHandle, mountSizeMib: number): Promise<void> {
  await vm.exec(
    `set -eu; mkdir -p /mnt/machinen-bench-mem; mountpoint -q /mnt/machinen-bench-mem || mount -t tmpfs -o size=${mountSizeMib}m tmpfs /mnt/machinen-bench-mem`,
    { execTimeoutMs: 60_000 },
  );
}

async function touchMemoryAndSample(vm: VmHandle, sizeMib: number): Promise<MemorySample> {
  process.stderr.write(`[memory:touch-${sizeMib}MiB] running...\n`);
  await vm.exec(
    `set -eu; dd if=/dev/zero of=/mnt/machinen-bench-mem/blob bs=1M count=${sizeMib} conv=notrunc status=none`,
    { execTimeoutMs: Math.max(300_000, sizeMib * 2000) },
  );
  await delay(500);
  return { touchedMib: sizeMib, stats: await compactMemoryStats(vm) };
}

function aggregateMemorySamples(touchedMib: number, samples: MemorySample[]): MemoryTouchAggregate {
  return {
    touchedMib,
    ceiling_mib: nullableStats(samples.map((sample) => sample.stats.ceilingMib)),
    host_rss_bytes: nullableStats(samples.map((sample) => sample.stats.hostRssBytes)),
    balloon_reclaimed_bytes: stats(samples.map((sample) => sample.stats.balloonReclaimedBytes)),
    lazy_pages_pending: stats(samples.map((sample) => sample.stats.lazyPagesPending)),
  };
}

function nullableStats(samples: Array<number | null>): Stats | null {
  const present = samples.filter((sample): sample is number => sample !== null);
  return present.length === 0 ? null : stats(present);
}

async function bootIdleVm(
  assets: ResourceBenchAssets,
  opts: { memoryMib?: number; cpu?: { maxVcpus: 1; quotaCpus: number } } = {},
): Promise<VmHandle> {
  const { boot } = await loadRuntime();
  return boot({
    image: assets.image,
    kernel: assets.kernel,
    dtb: assets.dtb,
    cmd: ["/bin/sh", "-c", "while :; do sleep 3600; done"],
    timeoutMs: 60_000,
    memory: opts.memoryMib,
    resources: opts.cpu ? { cpu: opts.cpu } : undefined,
  });
}

async function compactMemoryStats(vm: VmHandle): Promise<MemorySample["stats"]> {
  const stats = await vm.memoryStats();
  return {
    ceilingMib: stats.ceilingMib,
    hostRssBytes: stats.hostRssBytes,
    balloonReclaimedBytes: stats.balloonReclaimedBytes,
    lazyPagesPending: stats.lazyPagesPending,
  };
}

function printCpuSummary(suites: CpuBenchResult): void {
  console.log("\n=== CPU SHA256 throughput (avg MiB/s) ===");
  const rows: Array<[string, CpuSuite]> = [
    ["host_native", suites.host_native],
    ["guest_no_quota", suites.guest_no_quota],
    ["guest_quota_1", suites.guest_quota_1],
    ["guest_quota_0_5", suites.guest_quota_0_5],
  ];
  for (const [label, suite] of rows) {
    const avg = suite.aggregate.throughput_bytes_per_sec.avg / 1024 / 1024;
    console.log(`  ${label.padEnd(18)} ${avg.toFixed(1)}`);
  }
}

function printMemorySummary(result: MemoryBenchResult): void {
  console.log("\n=== Memory touch RSS (avg) ===");
  console.log(`  ${"touched".padEnd(12)} ${"host RSS".padStart(12)} ${"ceiling".padStart(10)}`);
  for (const row of sortedMemoryRows(result)) {
    console.log(memorySummaryLine(row));
  }
}

function sortedMemoryRows(result: MemoryBenchResult): MemoryTouchAggregate[] {
  return Object.values(result.by_touched_mib).sort((a, b) => a.touchedMib - b.touchedMib);
}

function memorySummaryLine(row: MemoryTouchAggregate): string {
  const rss = formatBytes(nullableAverage(row.host_rss_bytes)).padStart(12);
  const ceiling = formatMiB(nullableAverage(row.ceiling_mib)).padStart(10);
  return `  ${`${row.touchedMib} MiB`.padEnd(12)} ${rss} ${ceiling}`;
}

function nullableAverage(row: Stats | null): number | null {
  return row === null ? null : row.avg;
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

function elapsedSinceMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function throughput(bytes: number, elapsedMs: number): number {
  return elapsedMs <= 0 ? 0 : bytes / (elapsedMs / 1000);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function killVm(vm: VmHandle): Promise<void> {
  await vm.kill().catch(() => {});
  await vm.wait().catch(() => undefined);
}

function formatBytes(value: number | null): string {
  if (value === null) {
    return "?";
  }
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}

function formatMiB(value: number | null): string {
  if (value === null) {
    return "?";
  }
  return `${value.toFixed(0)} MiB`;
}
