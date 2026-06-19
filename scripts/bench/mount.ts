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
const SMALL_FILE_METADATA_COUNT = 1000;
const LARGE_SEQUENTIAL_WRITE_MIB = 64;

// Re-use the same base-asset resolution that scripts/bench-boot.ts does
// (kernel / dtb / starter image). The fallback path covers a fresh
// checkout that hasn't built release-assets yet.
const ASSETS = join(REPO_ROOT, "release-assets");
type GuestArch = "amd64" | "arm64";
type LiveMountCacheMode = "strict" | "cached" | "fast";

interface CliArgs {
  noDocker: boolean;
  fixtureKey: string;
  decompose: boolean;
  profile: boolean;
  cacheMode: LiveMountCacheMode;
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
  "--no-decompose": (ctx) => {
    ctx.args.decompose = false;
  },
  "--profile": (ctx) => {
    ctx.args.profile = true;
  },
  "--cache-mode": (ctx) => {
    ctx.args.cacheMode = parseCacheMode(takeBenchArgValue(ctx, "--cache-mode"));
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
    decompose: true,
    profile: false,
    cacheMode: "cached",
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
  console.log(
    "usage: tsx scripts/bench/mount.ts [--no-docker] [--no-decompose] [--profile] [--cache-mode strict|cached|fast] [--fixture <key>]",
  );
  process.exit(0);
}

function exitBenchArgError(message: string): never {
  console.error(message);
  process.exit(2);
}

function parseCacheMode(value: string): LiveMountCacheMode {
  if (value === "strict" || value === "cached" || value === "fast") {
    return value;
  }
  exitBenchArgError(`bench-mount: --cache-mode must be strict, cached, or fast (got ${value})`);
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

type ProfileJson =
  | null
  | boolean
  | number
  | string
  | ProfileJson[]
  | { [key: string]: ProfileJson };

interface RunResult {
  runId: string;
  host: HostInfo;
  fixtures: { tarball: string; tarballBytes: number };
  cacheMode: LiveMountCacheMode;
  workload: string;
  wallMs: number;
  phases: MountBenchPhases;
  profiles?: Record<string, ProfileJson>;
  docker: { wallMs: number } | null;
}

interface MountBenchPhases {
  vmBootMs: number;
  tarExtractMs: number;
  dockerBaselineMs?: number;
  hostNativeExtractMs?: number;
  guestInputCopyMs?: number;
  guestRootfsExtractMs?: number;
  liveReadOnlyExtractMs?: number;
  liveWriteOnlyExtractMs?: number;
  liveReadWriteExtractMs?: number;
  smallFileMetadataMs?: number;
  hostBatchApplyMs?: number;
  hostBatchApplyBytes?: number;
  batchTotalMs?: number;
  largeSequentialWriteMs?: number;
  largeSequentialWriteMiBPerSec?: number;
}

interface DecomposedMountPhases {
  hostNativeExtractMs: number;
  guestInputCopyMs: number;
  guestRootfsExtractMs: number;
  liveReadOnlyExtractMs: number;
  liveWriteOnlyExtractMs: number;
  liveReadWriteExtractMs: number;
  smallFileMetadataMs: number;
  hostBatchApplyMs: number;
  hostBatchApplyBytes: number;
  batchTotalMs: number;
  largeSequentialWriteMs: number;
  largeSequentialWriteMiBPerSec: number;
}

interface ProfilePaths {
  dir: string;
  out: string;
  input: string;
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

// fallow-ignore-next-line complexity
async function runMountBench(
  tarballPath: string,
  fixtureKey: string,
  args: CliArgs,
): Promise<RunResult> {
  const { boot } = await import("@machinen/runtime");
  const inputs = resolveBenchVmInputs();
  const scratch = createScratchDir();
  const profilePaths = args.profile ? createProfilePaths() : undefined;
  const workload = buildMountBenchWorkload(tarballPath);
  const runId = createRunId();
  logRunStart(runId, scratch);

  const hostNativeExtractMs = args.decompose ? runHostNativeExtract(tarballPath) : undefined;
  const booted = await bootMountBenchVm(
    boot,
    inputs,
    scratch,
    workload.tarballHostDir,
    profilePaths,
    args.cacheMode,
  );
  try {
    const wallMs = await runTarWorkload(booted.vm, workload.tarCmd);
    const decomposed = args.decompose
      ? await runDecomposedMountWorkloads(booted.vm, workload, wallMs, hostNativeExtractMs ?? 0)
      : undefined;
    if (profilePaths) {
      await runGuestWorkload(booted.vm, "profile flush nudge", profileFlushCommand(workload));
    }
    const profiles = profilePaths ? readProfileFiles(profilePaths) : undefined;
    return buildRunResult(
      runId,
      fixtureKey,
      args.cacheMode,
      workload,
      wallMs,
      booted.bootMs,
      decomposed,
      profiles,
    );
  } finally {
    await cleanupMountBenchRun(booted.vm, scratch, profilePaths?.dir);
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

function createProfilePaths(): ProfilePaths {
  const dir = join(tmpdir(), `machinen-bench-mount-profile-${process.pid}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return {
    dir,
    out: join(dir, "virtiofs-out.json"),
    input: join(dir, "virtiofs-in.json"),
  };
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
  profilePaths: ProfilePaths | undefined,
  cacheMode: LiveMountCacheMode,
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
      { host: scratch, guest: "/mnt/out", mode: "rw", cache: cacheMode },
      { host: tarballHostDir, guest: "/mnt/in", mode: "ro", cache: cacheMode },
    ],
    vmmEnv: profilePaths
      ? {
          MACHINEN_VIRTIOFS_PROFILE_0: profilePaths.out,
          MACHINEN_VIRTIOFS_PROFILE_1: profilePaths.input,
        }
      : undefined,
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
  return runGuestWorkload(vm, "live-read+write tar extract", tarCmd);
}

function runHostNativeExtract(tarballPath: string): number {
  const scratch = join(tmpdir(), `machinen-bench-mount-host-${process.pid}-${Date.now()}`);
  mkdirSync(scratch, { recursive: true });
  const ts = Date.now();
  try {
    const result = spawnSync("tar", ["-xzf", tarballPath, "-C", scratch], {
      encoding: "utf8",
      stdio: ["ignore", "ignore", "pipe"],
    });
    const wallMs = Date.now() - ts;
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`host tar exited ${result.status}\nstderr: ${result.stderr}`);
    }
    console.error(`bench-mount: host-native extract finished in ${wallMs}ms`);
    return wallMs;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function runDecomposedMountWorkloads(
  vm: BenchVmHandle,
  workload: MountBenchWorkload,
  liveReadWriteExtractMs: number,
  hostNativeExtractMs: number,
): Promise<DecomposedMountPhases> {
  const guestTarball = shellQuote(`/tmp/${workload.tarballName}`);
  const liveTarball = shellQuote(`/mnt/in/${workload.tarballName}`);

  const guestInputCopyMs = await runGuestWorkload(
    vm,
    "guest input copy from live mount",
    `rm -f ${guestTarball} && cp ${liveTarball} ${guestTarball}`,
  );
  const guestRootfsExtractMs = await runGuestWorkload(
    vm,
    "guest-rootfs tar extract",
    `rm -rf /tmp/machinen-bench-rootfs && mkdir -p /tmp/machinen-bench-rootfs && cd /tmp/machinen-bench-rootfs && tar -xzf ${guestTarball}`,
  );
  const liveReadOnlyExtractMs = await runGuestWorkload(
    vm,
    "live-read-only tar extract",
    `rm -rf /tmp/machinen-bench-live-read && mkdir -p /tmp/machinen-bench-live-read && cd /tmp/machinen-bench-live-read && tar -xzf ${liveTarball}`,
  );
  const liveWriteOnlyExtractMs = await runGuestWorkload(
    vm,
    "live-write-only tar extract",
    `rm -rf /mnt/out/live-write-only && mkdir -p /mnt/out/live-write-only && cd /mnt/out/live-write-only && tar -xzf ${guestTarball}`,
  );
  const smallFileMetadataMs = await runGuestWorkload(
    vm,
    "small-file metadata microbench",
    smallFileMetadataCommand(),
  );
  const hostBatchApply = await runHostBatchApplyFromGuestRootfs(vm);
  const largeSequentialWriteMs = await runGuestWorkload(
    vm,
    "large sequential write microbench",
    `rm -f /mnt/out/large-sequential-write.bin && dd if=/dev/zero of=/mnt/out/large-sequential-write.bin bs=1048576 count=${LARGE_SEQUENTIAL_WRITE_MIB} >/dev/null 2>&1`,
  );

  return {
    hostNativeExtractMs,
    guestInputCopyMs,
    guestRootfsExtractMs,
    liveReadOnlyExtractMs,
    liveWriteOnlyExtractMs,
    liveReadWriteExtractMs,
    smallFileMetadataMs,
    hostBatchApplyMs: hostBatchApply.wallMs,
    hostBatchApplyBytes: hostBatchApply.bytes,
    batchTotalMs: guestRootfsExtractMs + hostBatchApply.wallMs,
    largeSequentialWriteMs,
    largeSequentialWriteMiBPerSec: mibPerSecond(LARGE_SEQUENTIAL_WRITE_MIB, largeSequentialWriteMs),
  };
}

async function runHostBatchApplyFromGuestRootfs(
  vm: BenchVmHandle,
): Promise<{ wallMs: number; bytes: number }> {
  const chunks: Buffer[] = [];
  const guestStderr: Buffer[] = [];
  const hostDest = join(tmpdir(), `machinen-bench-host-batch-${process.pid}-${Date.now()}`);
  mkdirSync(hostDest, { recursive: true });
  const ts = Date.now();
  try {
    const result = await vm.execRaw("cd /tmp/machinen-bench-rootfs && tar -cf - .", {
      execTimeoutMs: 300_000,
      onStdout: (chunk) => chunks.push(Buffer.from(chunk)),
      onStderr: (chunk) => guestStderr.push(Buffer.from(chunk)),
    });
    if (result.exitCode !== 0) {
      throw new Error(
        `guest tar stream exited ${result.exitCode}\nstderr: ${Buffer.concat(guestStderr).toString("utf8")}`,
      );
    }
    const tarBytes = Buffer.concat(chunks);
    const extract = spawnSync("tar", ["-xf", "-", "-C", hostDest], {
      input: tarBytes,
      encoding: "buffer",
      stdio: ["pipe", "ignore", "pipe"],
    });
    if (extract.error) {
      throw extract.error;
    }
    if (extract.status !== 0) {
      throw new Error(`host batch tar exited ${extract.status}\nstderr: ${extract.stderr}`);
    }
    const wallMs = Date.now() - ts;
    console.error(
      `bench-mount: host batch apply from guest rootfs finished in ${wallMs}ms (${tarBytes.length} bytes)`,
    );
    return { wallMs, bytes: tarBytes.length };
  } finally {
    rmSync(hostDest, { recursive: true, force: true });
  }
}

function smallFileMetadataCommand(): string {
  return (
    "rm -rf /mnt/out/small-file-metadata && mkdir -p /mnt/out/small-file-metadata && " +
    `i=0; while [ "$i" -lt ${SMALL_FILE_METADATA_COUNT} ]; do ` +
    'f="/mnt/out/small-file-metadata/f$i"; ' +
    ': > "$f"; chmod 600 "$f"; stat "$f" >/dev/null; ' +
    'mv "$f" "$f.renamed"; rm "$f.renamed"; i=$((i + 1)); ' +
    "done"
  );
}

function profileFlushCommand(workload: MountBenchWorkload): string {
  const liveTarball = shellQuote(`/mnt/in/${workload.tarballName}`);
  return (
    `i=0; while [ "$i" -lt 260 ]; do ` +
    `stat /mnt/out >/dev/null; stat ${liveTarball} >/dev/null; ` +
    "i=$((i + 1)); done"
  );
}

async function runGuestWorkload(
  vm: BenchVmHandle,
  label: string,
  command: string,
): Promise<number> {
  const ts = Date.now();
  const result = await vm.execRaw(command, { execTimeoutMs: 300_000 });
  const wallMs = Date.now() - ts;
  if (result.exitCode !== 0) {
    throw new Error(
      `${label} exited ${result.exitCode}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
  console.error(`bench-mount: ${label} finished in ${wallMs}ms`);
  return wallMs;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function mibPerSecond(mib: number, ms: number): number {
  return ms <= 0 ? 0 : mib / (ms / 1000);
}

function buildRunResult(
  runId: string,
  fixtureKey: string,
  cacheMode: LiveMountCacheMode,
  workload: MountBenchWorkload,
  wallMs: number,
  bootMs: number,
  decomposed?: DecomposedMountPhases,
  profiles?: Record<string, ProfileJson>,
): RunResult {
  return {
    runId,
    host: hostInfo(),
    fixtures: { tarball: fixtureKey, tarballBytes: workload.tarballBytes },
    cacheMode,
    workload: workload.tarCmd,
    wallMs,
    phases: {
      vmBootMs: bootMs,
      tarExtractMs: wallMs,
      ...decomposed,
    },
    ...(profiles ? { profiles } : {}),
    docker: null,
  };
}

function readProfileFiles(profilePaths: ProfilePaths): Record<string, ProfileJson> {
  return {
    out: readProfileFile(profilePaths.out),
    in: readProfileFile(profilePaths.input),
  };
}

function readProfileFile(path: string): ProfileJson {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8")) as ProfileJson;
}

async function cleanupMountBenchRun(
  vm: BenchVmHandle,
  scratch: string,
  profileDir?: string,
): Promise<void> {
  await vm.kill().catch(() => {});
  await vm.wait().catch(() => undefined);
  try {
    rmSync(scratch, { recursive: true, force: true });
    if (profileDir) {
      rmSync(profileDir, { recursive: true, force: true });
    }
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

// fallow-ignore-next-line complexity
function printTable(result: RunResult): void {
  const docker = result.docker ? result.docker.wallMs : null;
  const ratio = docker ? (result.wallMs / docker).toFixed(2) : "n/a";
  console.log("");
  console.log(`run: ${result.runId}`);
  console.log(`host: ${result.host.os}/${result.host.arch} ${result.host.hostname}`);
  console.log(`cache mode: ${result.cacheMode}`);
  console.log("");
  console.log(`wall-clock tar-extract   ${(result.wallMs / 1000).toFixed(2)}s`);
  console.log(
    `docker baseline same     ${docker ? (docker / 1000).toFixed(2) + "s" : "(skipped)"}`,
  );
  console.log(`ratio virtio-fs / docker ${ratio}×`);
  printDecomposedTable(result.phases);
  if (result.profiles) {
    console.log("");
    console.log(
      "virtio-fs profiles captured for mounts: " + Object.keys(result.profiles).join(", "),
    );
  }
  console.log("");
  console.log(`result JSON:  scripts/bench/mount/results/${result.runId}.json`);
}

function printDecomposedTable(phases: MountBenchPhases): void {
  if (phases.hostNativeExtractMs === undefined) {
    return;
  }
  console.log("");
  console.log("decomposed mount timings");
  console.log(`host native extract      ${formatMs(phases.hostNativeExtractMs)}`);
  console.log(`guest input copy         ${formatMs(phases.guestInputCopyMs)}`);
  console.log(`guest rootfs extract     ${formatMs(phases.guestRootfsExtractMs)}`);
  console.log(`live-read-only extract   ${formatMs(phases.liveReadOnlyExtractMs)}`);
  console.log(`live-write-only extract  ${formatMs(phases.liveWriteOnlyExtractMs)}`);
  console.log(`live-read+write extract  ${formatMs(phases.liveReadWriteExtractMs)}`);
  console.log(
    `small-file metadata     ${formatMs(phases.smallFileMetadataMs)} (${SMALL_FILE_METADATA_COUNT} files)`,
  );
  console.log(
    `batch apply estimate    ${formatMs(phases.hostBatchApplyMs)} (${formatBytes(phases.hostBatchApplyBytes)})`,
  );
  console.log(`batch total estimate    ${formatMs(phases.batchTotalMs)}`);
  console.log(
    `large sequential write  ${formatMs(phases.largeSequentialWriteMs)} (${formatRate(phases.largeSequentialWriteMiBPerSec)})`,
  );
}

function formatMs(value: number | undefined): string {
  return value === undefined ? "n/a" : `${(value / 1000).toFixed(2)}s`;
}

function formatRate(value: number | undefined): string {
  return value === undefined ? "n/a" : `${value.toFixed(1)} MiB/s`;
}

function formatBytes(value: number | undefined): string {
  return value === undefined ? "n/a" : `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const entry = loadFixture(args.fixtureKey);
  const tarballPath = await downloadAndVerify(entry);

  const result = await runMountBench(tarballPath, args.fixtureKey, args);

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
