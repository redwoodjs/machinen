import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ExternalSuiteArgs {
  n: number;
  guestArch?: string;
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

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function runMountBenchSuite(args: ExternalSuiteArgs, repoRoot: string): JsonValue {
  const resultsDir = join(repoRoot, "scripts", "bench", "mount", "results");
  const samples = emptyMountSamples();
  for (let i = 0; i < args.n; i++) {
    process.stderr.write(`[mount:${i + 1}] running...\n`);
    appendMountSamples(samples, runOneMountBench(args, repoRoot, resultsDir));
  }
  return mountSuiteJson(samples);
}

interface MountSamples {
  wallMs: number[];
  vmBootMs: number[];
  hostNativeExtractMs: number[];
  guestInputCopyMs: number[];
  guestRootfsExtractMs: number[];
  liveReadOnlyExtractMs: number[];
  liveWriteOnlyExtractMs: number[];
  liveReadWriteExtractMs: number[];
  smallFileMetadataMs: number[];
  largeSequentialWriteMs: number[];
  largeSequentialWriteMiBPerSec: number[];
  dockerWallMs: number[];
  ratios: number[];
}

function emptyMountSamples(): MountSamples {
  return {
    wallMs: [],
    vmBootMs: [],
    hostNativeExtractMs: [],
    guestInputCopyMs: [],
    guestRootfsExtractMs: [],
    liveReadOnlyExtractMs: [],
    liveWriteOnlyExtractMs: [],
    liveReadWriteExtractMs: [],
    smallFileMetadataMs: [],
    largeSequentialWriteMs: [],
    largeSequentialWriteMiBPerSec: [],
    dockerWallMs: [],
    ratios: [],
  };
}

// fallow-ignore-next-line complexity
function appendMountSamples(samples: MountSamples, result: MountResult): void {
  samples.wallMs.push(mountTarExtractMs(result));
  appendIfNumber(samples.vmBootMs, mountVmBootMs(result));
  appendIfNumber(samples.hostNativeExtractMs, result.phases?.hostNativeExtractMs);
  appendIfNumber(samples.guestInputCopyMs, result.phases?.guestInputCopyMs);
  appendIfNumber(samples.guestRootfsExtractMs, result.phases?.guestRootfsExtractMs);
  appendIfNumber(samples.liveReadOnlyExtractMs, result.phases?.liveReadOnlyExtractMs);
  appendIfNumber(samples.liveWriteOnlyExtractMs, result.phases?.liveWriteOnlyExtractMs);
  appendIfNumber(samples.liveReadWriteExtractMs, result.phases?.liveReadWriteExtractMs);
  appendIfNumber(samples.smallFileMetadataMs, result.phases?.smallFileMetadataMs);
  appendIfNumber(samples.largeSequentialWriteMs, result.phases?.largeSequentialWriteMs);
  appendIfNumber(
    samples.largeSequentialWriteMiBPerSec,
    result.phases?.largeSequentialWriteMiBPerSec,
  );
  appendIfNumber(samples.dockerWallMs, mountDockerWallMs(result));
  appendMountDockerRatio(samples.ratios, result);
}

function mountTarExtractMs(result: MountResult): number {
  return result.phases?.tarExtractMs ?? result.wallMs;
}

function mountVmBootMs(result: MountResult): number | undefined {
  return result.phases?.vmBootMs;
}

function mountDockerWallMs(result: MountResult): number | undefined {
  return result.docker?.wallMs;
}

function appendMountDockerRatio(out: number[], result: MountResult): void {
  if (result.docker?.wallMs) {
    out.push(result.wallMs / result.docker.wallMs);
  }
}

function mountSuiteJson(samples: MountSamples): JsonValue {
  return {
    phases: {
      vm_boot_ms: nullableStats(samples.vmBootMs) as unknown as JsonValue,
      tar_extract_wall_ms: stats(samples.wallMs) as unknown as JsonValue,
      host_native_extract_ms: nullableStats(samples.hostNativeExtractMs) as unknown as JsonValue,
      guest_input_copy_ms: nullableStats(samples.guestInputCopyMs) as unknown as JsonValue,
      guest_rootfs_extract_ms: nullableStats(samples.guestRootfsExtractMs) as unknown as JsonValue,
      live_read_only_extract_ms: nullableStats(
        samples.liveReadOnlyExtractMs,
      ) as unknown as JsonValue,
      live_write_only_extract_ms: nullableStats(
        samples.liveWriteOnlyExtractMs,
      ) as unknown as JsonValue,
      live_read_write_extract_ms: nullableStats(
        samples.liveReadWriteExtractMs,
      ) as unknown as JsonValue,
      small_file_metadata_ms: nullableStats(samples.smallFileMetadataMs) as unknown as JsonValue,
      large_sequential_write_ms: nullableStats(
        samples.largeSequentialWriteMs,
      ) as unknown as JsonValue,
      large_sequential_write_mib_per_sec: nullableStats(
        samples.largeSequentialWriteMiBPerSec,
      ) as unknown as JsonValue,
      docker_wall_ms: nullableStats(samples.dockerWallMs) as unknown as JsonValue,
      ratio_to_docker: nullableStats(samples.ratios) as unknown as JsonValue,
    },
  };
}

function runOneMountBench(
  args: ExternalSuiteArgs,
  repoRoot: string,
  resultsDir: string,
): MountResult {
  const before = latestMountResultPath(resultsDir);
  execFileSync("pnpm", ["exec", "tsx", "scripts/bench/mount.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: externalSuiteEnv(args),
    stdio: "pipe",
  });
  const resultPath = latestMountResultPath(resultsDir, before);
  if (!resultPath) {
    throw new Error("bench: mount suite did not write a result JSON");
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as MountResult;
}

interface MountResult {
  wallMs: number;
  phases?: {
    vmBootMs?: number;
    tarExtractMs?: number;
    dockerBaselineMs?: number;
    hostNativeExtractMs?: number;
    guestInputCopyMs?: number;
    guestRootfsExtractMs?: number;
    liveReadOnlyExtractMs?: number;
    liveWriteOnlyExtractMs?: number;
    liveReadWriteExtractMs?: number;
    smallFileMetadataMs?: number;
    largeSequentialWriteMs?: number;
    largeSequentialWriteMiBPerSec?: number;
  };
  docker?: { wallMs: number } | null;
}

function latestMountResultPath(
  resultsDir: string,
  previous?: string | undefined,
): string | undefined {
  if (!existsSync(resultsDir)) {
    return undefined;
  }
  return readdirSync(resultsDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => join(resultsDir, name))
    .filter((path) => path !== previous)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export function runNetBenchSuite(args: ExternalSuiteArgs, repoRoot: string): JsonValue {
  process.stderr.write(`[net] running ${args.n} iterations per scenario...\n`);
  const stdout = execFileSync("bash", ["scripts/bench-net.sh", "-n", String(args.n)], {
    cwd: repoRoot,
    encoding: "utf8",
    env: externalSuiteEnv(args),
    stdio: "pipe",
  });
  return { phases: netPhaseAggregates(parseNetBenchValues(stdout)) };
}

function netPhaseAggregates(values: Record<string, number[]>): { [key: string]: JsonValue } {
  const phases: { [key: string]: JsonValue } = {};
  for (const [mode, samples] of Object.entries(values)) {
    phases[mode] = {
      metric: mode === "latency" ? "us_per_ping" : "mb_per_sec",
      aggregate: stats(samples) as unknown as JsonValue,
    };
  }
  return phases;
}

function parseNetBenchValues(stdout: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const line of stdout.split("\n")) {
    appendNetBenchValue(out, line);
  }
  return out;
}

function appendNetBenchValue(out: Record<string, number[]>, line: string): void {
  const parsed = parseNetBenchLine(line);
  if (parsed) {
    out[parsed.mode] = [...(out[parsed.mode] ?? []), parsed.value];
  }
}

function parseNetBenchLine(line: string): { mode: string; value: number } | undefined {
  const mode = /bench-net: mode=([^\s]+)/.exec(line)?.[1];
  if (!mode) {
    return undefined;
  }
  const value = netBenchMetricValue(line, metricForMode(mode));
  return value === undefined ? undefined : { mode, value };
}

function metricForMode(mode: string): string {
  return mode === "latency" ? "us_per_ping" : "mb_per_sec";
}

function netBenchMetricValue(line: string, metric: string): number | undefined {
  const value = new RegExp(`${metric}=([0-9.]+)`).exec(line)?.[1];
  return value === undefined ? undefined : Number(value);
}

function externalSuiteEnv(args: ExternalSuiteArgs): NodeJS.ProcessEnv {
  return args.guestArch ? { ...process.env, MACHINEN_GUEST_ARCH: args.guestArch } : process.env;
}

function appendIfNumber(out: number[], value: number | undefined): void {
  if (value !== undefined) {
    out.push(value);
  }
}

function nullableStats(samples: number[]): Stats | null {
  return samples.length === 0 ? null : stats(samples);
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
