// Live-mount bench: time a `tar -xzf node-….tar.gz` inside a machinen
// VM writing through a `--mount-live` mount, and compare the wall-clock
// against a docker baseline.
//
// Output:
//   scripts/bench/mount/results/<runId>.json
//
// What we measure:
//   - Wall-clock from "start tar" → "tar exited" inside the guest,
//     writing through an in-VMM virtio-fs live mount (#332).
//   - docker baseline wall-clock from docker-baseline.sh (skipped with
//     `--no-docker`).
//
// Usage:
//   pnpm tsx scripts/bench/mount.ts             # virtio-fs + docker
//   pnpm tsx scripts/bench/mount.ts --no-docker # virtio-fs only
//
// #338 removed the FUSE-over-vsock transport, so there's a single
// live-mount path now: the in-VMM virtio-fs device. It writes no host-
// side stats file, so the bench reports wall-clock vs docker only — no
// per-op handler histogram.
//
// Exit codes: 0 success. 2 missing fixtures / args / placeholder sha256.
// 3 a run step failed.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { arch, platform } from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const BENCH_DIR = join(HERE, "mount");
const RESULTS_DIR = join(BENCH_DIR, "results");
const FIXTURES_PATH = join(BENCH_DIR, "fixtures.json");
const TARBALL_CACHE = join(homedir(), ".cache", "machinen-bench", "tarballs");

// Re-use the same base-asset resolution that scripts/bench-boot.ts does
// (kernel / dtb / starter image). The fallback path covers a fresh
// checkout that hasn't built release-assets yet.
const ASSETS = join(REPO_ROOT, "release-assets");
type GuestArch = "amd64" | "arm64";

interface CliArgs {
  noDocker: boolean;
  fixtureKey: string;
}

interface ParseContext {
  args: CliArgs;
  index: number;
}

type BenchArgHandler = (ctx: ParseContext) => void;

const BENCH_ARG_HANDLERS: Record<string, BenchArgHandler> = {
  "--no-docker": (ctx) => {
    ctx.args.noDocker = true;
  },
  "--fixture": (ctx) => {
    ctx.args.fixtureKey = takeBenchArgValue(ctx, "--fixture");
  },
  "-h": () => printBenchUsageAndExit(),
  "--help": () => printBenchUsageAndExit(),
};

function parseArgs(): CliArgs {
  const ctx: ParseContext = { args: defaultCliArgs(), index: 2 };
  for (; ctx.index < process.argv.length; ctx.index++) {
    applyBenchArg(ctx);
  }
  return ctx.args;
}

function defaultCliArgs(): CliArgs {
  return {
    noDocker: false,
    fixtureKey: "node-24-linux-arm64",
  };
}

function applyBenchArg(ctx: ParseContext): void {
  const arg = process.argv[ctx.index]!;
  const handler = BENCH_ARG_HANDLERS[arg];
  if (!handler) {
    exitBenchArgError(`bench-mount: unknown arg ${arg}`);
  }
  handler(ctx);
}

function takeBenchArgValue(ctx: ParseContext, name: string): string {
  const value = process.argv[++ctx.index];
  if (!value) {
    exitBenchArgError(`bench-mount: ${name} requires a value`);
  }
  return value;
}

function printBenchUsageAndExit(): never {
  console.log("usage: tsx scripts/bench/mount.ts [--no-docker] [--fixture <key>]");
  process.exit(0);
}

function exitBenchArgError(message: string): never {
  console.error(message);
  process.exit(2);
}

interface FixtureEntry {
  url: string;
  sha256: string;
  extractsToDir: string;
}

function loadFixture(key: string): FixtureEntry {
  const raw = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as {
    tarballs: Record<string, FixtureEntry>;
  };
  const entry = raw.tarballs[key];
  if (!entry) {
    console.error(`bench-mount: fixture key "${key}" not in ${FIXTURES_PATH}`);
    process.exit(2);
  }
  if (entry.sha256 === "POPULATE_FROM_SHASUMS256_TXT" || !entry.sha256) {
    console.error(
      `bench-mount: fixture "${key}" has placeholder sha256.\n` +
        `Populate it from the upstream SHASUMS256.txt and re-run.`,
    );
    process.exit(2);
  }
  return entry;
}

async function downloadAndVerify(entry: FixtureEntry): Promise<string> {
  mkdirSync(TARBALL_CACHE, { recursive: true });
  const tarballPath = join(TARBALL_CACHE, basename(entry.url));
  if (useValidCachedTarball(tarballPath, entry)) {
    return tarballPath;
  }
  await downloadTarball(entry, tarballPath);
  return tarballPath;
}

function useValidCachedTarball(tarballPath: string, entry: FixtureEntry): boolean {
  if (!existsSync(tarballPath)) {
    return false;
  }
  const got = sha256File(tarballPath);
  if (got === entry.sha256) {
    return true;
  }
  console.error(
    `bench-mount: cached tarball has wrong sha256 (got ${got}, want ${entry.sha256}). Re-downloading.`,
  );
  rmSync(tarballPath);
  return false;
}

async function downloadTarball(entry: FixtureEntry, tarballPath: string): Promise<void> {
  console.error(`bench-mount: downloading ${entry.url} → ${tarballPath}`);
  const res = await fetch(entry.url);
  assertDownloadResponse(res);
  const tmp = `${tarballPath}.tmp.${process.pid}`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  verifyDownloadedTarball(tmp, entry);
  renameSync(tmp, tarballPath);
}

function assertDownloadResponse(
  res: Response,
): asserts res is Response & { body: NonNullable<Response["body"]> } {
  if (!res.ok || !res.body) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
}

function verifyDownloadedTarball(tmp: string, entry: FixtureEntry): void {
  const got = sha256File(tmp);
  if (got === entry.sha256) {
    return;
  }
  rmSync(tmp);
  throw new Error(`sha256 mismatch for ${entry.url}: got ${got}, want ${entry.sha256}`);
}

function sha256File(path: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

function pickFirstExisting(candidates: string[]): string {
  for (const c of candidates) {
    if (existsSync(c)) {
      return c;
    }
  }
  return candidates[0]!;
}

interface HostInfo {
  os: string;
  arch: string;
  hostname: string;
}

function hostInfo(): HostInfo {
  return { os: platform, arch, hostname: hostname() };
}

interface DockerResult {
  wallMs: number;
  scratchPath: string;
}

function runDockerBaseline(tarballPath: string): DockerResult | null {
  const script = join(BENCH_DIR, "docker-baseline.sh");
  const r = spawnSync("bash", [script, tarballPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (r.status !== 0) {
    console.error(`bench-mount: docker baseline failed (exit ${r.status})`);
    return null;
  }
  try {
    return JSON.parse(r.stdout.trim()) as DockerResult;
  } catch (err) {
    console.error(
      `bench-mount: docker baseline produced un-parseable stdout: ${r.stdout}\n${(err as Error).message}`,
    );
    return null;
  }
}

interface RunResult {
  runId: string;
  host: HostInfo;
  fixtures: { tarball: string; tarballBytes: number };
  workload: string;
  wallMs: number;
  phases: {
    vmBootMs: number;
    tarExtractMs: number;
    dockerBaselineMs?: number;
  };
  docker: { wallMs: number } | null;
}

type RuntimeBoot = (typeof import("@machinen/runtime"))["boot"];
type BenchVmHandle = Awaited<ReturnType<RuntimeBoot>>;

interface BenchVmInputs {
  kernel: string;
  dtb?: string;
  image: string;
}

interface MountBenchWorkload {
  tarballName: string;
  tarballBytes: number;
  tarballHostDir: string;
  tarCmd: string;
}

async function runMountBench(tarballPath: string, fixtureKey: string): Promise<RunResult> {
  const { boot } = await import("@machinen/runtime");
  const inputs = resolveBenchVmInputs();
  const scratch = createScratchDir();
  const workload = buildMountBenchWorkload(tarballPath);
  const runId = createRunId();
  logRunStart(runId, scratch);

  const booted = await bootMountBenchVm(boot, inputs, scratch, workload.tarballHostDir);
  try {
    const wallMs = await runTarWorkload(booted.vm, workload.tarCmd);
    return buildRunResult(runId, fixtureKey, workload, wallMs, booted.bootMs);
  } finally {
    await cleanupMountBenchRun(booted.vm, scratch);
  }
}

function resolveBenchVmInputs(): BenchVmInputs {
  const guestArch = defaultGuestArch();
  const fallbackBase = join(
    homedir(),
    ".machinen",
    "runtime-v0.0.0",
    "bases",
    `debian-${guestArch}`,
  );
  const inputs =
    guestArch === "amd64"
      ? {
          kernel: pickFirstExisting([join(ASSETS, "bzImage-x86_64"), join(fallbackBase, "Image")]),
          image: pickFirstExisting([
            join(ASSETS, "rootfs-debian-amd64.tar.gz"),
            join(fallbackBase, "rootfs.tar.gz"),
          ]),
        }
      : {
          kernel: pickFirstExisting([join(ASSETS, "Image-arm64"), join(fallbackBase, "Image")]),
          dtb: pickFirstExisting([join(ASSETS, "virt-arm64.dtb"), join(fallbackBase, "virt.dtb")]),
          image: pickFirstExisting([
            join(ASSETS, "rootfs-debian-arm64.tar.gz"),
            join(fallbackBase, "rootfs.tar.gz"),
          ]),
        };
  ensureBenchFixtures([inputs.kernel, inputs.dtb, inputs.image].filter(Boolean));
  return inputs;
}

function defaultGuestArch(): GuestArch {
  const override = process.env.MACHINEN_GUEST_ARCH;
  if (override === "amd64" || override === "arm64") {
    return override;
  }
  return arch === "x64" ? "amd64" : "arm64";
}

function ensureBenchFixtures(paths: string[]): void {
  for (const path of paths) {
    ensureBenchFixture(path);
  }
}

function ensureBenchFixture(path: string): void {
  if (!existsSync(path)) {
    console.error(
      `bench-mount: missing fixture ${path}. Run scripts/build-base-assets.sh + pnpm provision.`,
    );
    process.exit(2);
  }
}

function createScratchDir(): string {
  const scratch = join(tmpdir(), `machinen-bench-mount-${process.pid}-${Date.now()}`);
  mkdirSync(scratch, { recursive: true });
  return scratch;
}

function buildMountBenchWorkload(tarballPath: string): MountBenchWorkload {
  const tarballName = basename(tarballPath);
  return {
    tarballName,
    tarballBytes: readFileSync(tarballPath).length,
    tarballHostDir: dirname(tarballPath),
    tarCmd: `cd /mnt/out && tar -xzf /mnt/in/${tarballName}`,
  };
}

function createRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function logRunStart(runId: string, scratch: string): void {
  console.error(`bench-mount: runId=${runId}`);
  console.error(`bench-mount: scratch=${scratch}`);
}

async function bootMountBenchVm(
  boot: RuntimeBoot,
  inputs: BenchVmInputs,
  scratch: string,
  tarballHostDir: string,
): Promise<{ vm: BenchVmHandle; bootMs: number }> {
  const t0 = Date.now();
  const vm = await boot({
    image: inputs.image,
    kernel: inputs.kernel,
    dtb: inputs.dtb,
    cmd: ["/bin/sh", "-c", "while :; do sleep 1; done"],
    // `/mnt/out` is the measured write side; `/mnt/in` is a read-only
    // convenience mount carrying the tarball source. Both ride in-VMM
    // virtio-fs devices.
    liveMounts: [
      { host: scratch, guest: "/mnt/out", mode: "rw" },
      { host: tarballHostDir, guest: "/mnt/in", mode: "ro" },
    ],
    timeoutMs: 120_000,
  });
  const bootMs = Date.now() - t0;
  console.error(`bench-mount: VM booted (${bootMs}ms)`);
  return { vm, bootMs };
}

async function runTarWorkload(vm: BenchVmHandle, tarCmd: string): Promise<number> {
  // Time the actual workload: shell out to tar inside the guest. The
  // `time` line goes to stderr; we read wall via host hrtime because
  // it's the user-visible number we promised in the README.
  const ts = Date.now();
  const tarRes = await vm.execRaw(tarCmd, { execTimeoutMs: 300_000 });
  const wallMs = Date.now() - ts;
  if (tarRes.exitCode !== 0) {
    throw new Error(
      `tar exited ${tarRes.exitCode}\nstdout: ${tarRes.stdout}\nstderr: ${tarRes.stderr}`,
    );
  }
  console.error(`bench-mount: tar finished in ${wallMs}ms`);
  return wallMs;
}

function buildRunResult(
  runId: string,
  fixtureKey: string,
  workload: MountBenchWorkload,
  wallMs: number,
  bootMs: number,
): RunResult {
  return {
    runId,
    host: hostInfo(),
    fixtures: { tarball: fixtureKey, tarballBytes: workload.tarballBytes },
    workload: workload.tarCmd,
    wallMs,
    phases: { vmBootMs: bootMs, tarExtractMs: wallMs },
    docker: null,
  };
}

async function cleanupMountBenchRun(vm: BenchVmHandle, scratch: string): Promise<void> {
  await vm.kill().catch(() => {});
  await vm.wait().catch(() => undefined);
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {}
}

function writeResult(result: RunResult): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const out = join(RESULTS_DIR, `${result.runId}.json`);
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(result, null, 2)}\n`);
  renameSync(tmp, out);
  return out;
}

function printTable(result: RunResult): void {
  const docker = result.docker ? result.docker.wallMs : null;
  const ratio = docker ? (result.wallMs / docker).toFixed(2) : "n/a";
  console.log("");
  console.log(`run: ${result.runId}`);
  console.log(`host: ${result.host.os}/${result.host.arch} ${result.host.hostname}`);
  console.log("");
  console.log(`wall-clock tar-extract   ${(result.wallMs / 1000).toFixed(2)}s`);
  console.log(
    `docker baseline same     ${docker ? (docker / 1000).toFixed(2) + "s" : "(skipped)"}`,
  );
  console.log(`ratio virtio-fs / docker ${ratio}×`);
  console.log("");
  console.log(`result JSON:  scripts/bench/mount/results/${result.runId}.json`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const entry = loadFixture(args.fixtureKey);
  const tarballPath = await downloadAndVerify(entry);

  const result = await runMountBench(tarballPath, args.fixtureKey);

  if (!args.noDocker) {
    const dock = runDockerBaseline(tarballPath);
    if (dock) {
      result.docker = { wallMs: dock.wallMs };
      result.phases.dockerBaselineMs = dock.wallMs;
      try {
        rmSync(dock.scratchPath, { recursive: true, force: true });
      } catch {}
    }
  }

  const written = writeResult(result);
  console.error(`bench-mount: wrote ${written}`);
  printTable(result);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("bench-mount failed:", err instanceof Error ? err.stack || err.message : err);
    process.exit(3);
  },
);
