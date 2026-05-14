// #329 baseline bench: time a `tar -xJf node-….tar.xz` inside a
// machinen VM with a `--mount-live` mount, with the mount-server
// running under MACHINEN_MOUNT_SERVER_PROFILE=1.
//
// Output:
//   scripts/bench/mount/results/<runId>.json
//   scripts/bench/mount/results/<runId>.perfmap (when --perf-basic-prof
//     left a /tmp/perf-<pid>.map we could grab)
//
// What we measure:
//   - Wall-clock from "start tar" → "tar exited" inside the guest.
//   - Per-op latency histogram via LiveMountServerHandle.opStats(),
//     reflected through the helper's stats JSON.
//   - idleMs = wallMs − sum(ops.sumNs)/1e6 — the wire/IO gap.
//   - docker baseline wall-clock from docker-baseline.sh (skipped with
//     `--no-docker`).
//
// Usage:
//   pnpm tsx scripts/bench/mount.ts             # mount-server + docker
//   pnpm tsx scripts/bench/mount.ts --no-docker # mount-server only
//
// As of #329 the mount-server is Zig-native; the bench previously
// compared "JS Before" vs "Zig After" but the JS path is gone now —
// the surviving function name `runJsServerBench` reflects the
// historical naming and stays for the result-file column key.
//
// Exit codes: 0 success. 2 missing fixtures / args / placeholder sha256.
// 3 a run step failed.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
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
const FALLBACK_BASE = join(homedir(), ".machinen", "runtime-v0.0.0", "bases", "debian-arm64");

interface CliArgs {
  noDocker: boolean;
  fixtureKey: string;
  // #332: which live-mount transport to bench. "fuse" is the
  // FUSE-over-vsock mount-server; "virtiofs" is the in-VMM virtio-fs
  // device. The headline `wallMs` is transport-agnostic, so the two
  // runs are directly comparable against the same docker baseline.
  protocol: "fuse" | "virtiofs";
}

function parseArgs(): CliArgs {
  const out: CliArgs = {
    noDocker: false,
    fixtureKey: "node-24-linux-arm64",
    protocol: "fuse",
  };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i]!;
    if (a === "--no-docker") {
      out.noDocker = true;
    } else if (a === "--fixture") {
      out.fixtureKey = process.argv[++i] ?? "";
    } else if (a === "--protocol") {
      const v = process.argv[++i];
      if (v !== "fuse" && v !== "virtiofs") {
        console.error(`bench-mount: --protocol must be 'fuse' or 'virtiofs', got '${v}'`);
        process.exit(2);
      }
      out.protocol = v;
    } else if (a === "-h" || a === "--help") {
      console.log(
        "usage: tsx scripts/bench/mount.ts [--no-docker] [--fixture <key>] " +
          "[--protocol fuse|virtiofs]",
      );
      process.exit(0);
    } else {
      console.error(`bench-mount: unknown arg ${a}`);
      process.exit(2);
    }
  }
  return out;
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
  if (existsSync(tarballPath)) {
    const got = sha256File(tarballPath);
    if (got === entry.sha256) {
      return tarballPath;
    }
    console.error(
      `bench-mount: cached tarball has wrong sha256 (got ${got}, want ${entry.sha256}). Re-downloading.`,
    );
    rmSync(tarballPath);
  }
  console.error(`bench-mount: downloading ${entry.url} → ${tarballPath}`);
  const res = await fetch(entry.url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed: ${res.status} ${res.statusText}`);
  }
  const tmp = `${tarballPath}.tmp.${process.pid}`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  const got = sha256File(tmp);
  if (got !== entry.sha256) {
    rmSync(tmp);
    throw new Error(`sha256 mismatch for ${entry.url}: got ${got}, want ${entry.sha256}`);
  }
  renameSync(tmp, tarballPath);
  return tarballPath;
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

interface OpHistogramShape {
  count: number;
  sumNs: number;
  p50Ns: number;
  p99Ns: number;
}

interface RunResult {
  runId: string;
  host: HostInfo;
  fixtures: { tarball: string; tarballBytes: number };
  // #332: the live-mount transport the measured `/mnt/out` write side
  // used for this run.
  protocol: "fuse" | "virtiofs";
  workload: string;
  wallMs: number;
  docker: { wallMs: number } | null;
  // The vsock mount-server's op histogram + idle gap. `null` for the
  // virtio-fs path: the in-VMM device writes no stats file, and the
  // headline `wallMs` is the number the README's acceptance bar reads.
  mountServer: {
    bytesServedOnPagesImg: number;
    ops: Record<string, OpHistogramShape>;
    idleMs: number;
    perfMap: string | null;
  } | null;
}

async function runJsServerBench(
  tarballPath: string,
  fixtureKey: string,
  protocol: "fuse" | "virtiofs",
): Promise<RunResult> {
  // Dynamically import the runtime so any DEBUG knobs we set here land
  // before `debug` snapshots them at module import time.
  process.env.MACHINEN_MOUNT_SERVER_PROFILE = "1";
  const { boot } = await import("@machinen/runtime");

  const kernel = pickFirstExisting([join(ASSETS, "Image-arm64"), join(FALLBACK_BASE, "Image")]);
  const dtb = pickFirstExisting([join(ASSETS, "virt-arm64.dtb"), join(FALLBACK_BASE, "virt.dtb")]);
  const image = pickFirstExisting([
    join(ASSETS, "rootfs-debian-arm64.tar.gz"),
    join(FALLBACK_BASE, "rootfs.tar.gz"),
  ]);
  for (const p of [kernel, dtb, image]) {
    if (!existsSync(p)) {
      console.error(
        `bench-mount: missing fixture ${p}. Run scripts/build-base-assets.sh + pnpm provision.`,
      );
      process.exit(2);
    }
  }

  // Per-run host scratch — the guest writes through to this directory
  // over the live-mount channel. Removed after the bench so repeated
  // runs don't accumulate.
  const scratch = join(tmpdir(), `machinen-bench-mount-${process.pid}-${Date.now()}`);
  mkdirSync(scratch, { recursive: true });

  const tarballName = basename(tarballPath);
  const tarballBytes = readFileSync(tarballPath).length;

  // The exec-agent reads the tarball from a path inside the guest. Two
  // ways to get it there: copy via writeFile (we'd pay the same vsock
  // cost we're benching), or mount the host directory holding the
  // tarball as a separate read-only live-mount. The latter is cleaner —
  // the write-side mount is the one being measured.
  const tarballHostDir = dirname(tarballPath);

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  console.error(`bench-mount: runId=${runId} protocol=${protocol}`);
  console.error(`bench-mount: scratch=${scratch}`);

  const t0 = Date.now();
  const vm = await boot({
    image,
    kernel,
    dtb,
    cmd: ["/bin/sh", "-c", "while :; do sleep 1; done"],
    // The measured write side (`/mnt/out`) carries the transport under
    // test. The tarball source (`/mnt/in`) stays on fuse — it's a
    // read-only convenience mount, not part of the measurement, and
    // the VMM wires only one virtio-fs slot.
    liveMounts: [
      { host: scratch, guest: "/mnt/out", mode: "rw", protocol },
      { host: tarballHostDir, guest: "/mnt/in", mode: "ro", protocol: "fuse" },
    ],
    timeoutMs: 120_000,
  });
  console.error(`bench-mount: VM booted (${Date.now() - t0}ms)`);

  let result: RunResult;
  try {
    // Time the actual workload: shell out to tar inside the guest. The
    // `time` line goes to stderr; we read wall via host hrtime because
    // it's the user-visible number we promised in the README.
    const tarCmd = `cd /mnt/out && tar -xzf /mnt/in/${tarballName}`;
    const ts = Date.now();
    const tarRes = await vm.execRaw(tarCmd, { execTimeoutMs: 300_000 });
    const wallMs = Date.now() - ts;
    if (tarRes.exitCode !== 0) {
      throw new Error(
        `tar exited ${tarRes.exitCode}\nstdout: ${tarRes.stdout}\nstderr: ${tarRes.stderr}`,
      );
    }
    console.error(`bench-mount: tar finished in ${wallMs}ms`);

    // Snapshot the mount-server stats BEFORE the VM stops — once we
    // kill the VMM, pdeathsig brings the mount-server-bin down and its
    // stats path gets rm'd by the helper's shutdown handler. The
    // runtime doesn't expose mount-server stats via VmHandle, so we
    // glob the temp dirs the runtime creates with `mkdtempSync(join(
    // tmpdir(), "machinen-vsock-"))` and read every
    // `live-mount-*-stats.json` we own. A proper VmHandle accessor
    // would be cleaner — left as a follow-up when the bench shape is
    // settled.
    //
    // #332: only the fuse transport has a stats file. The virtio-fs
    // device runs in-VMM and writes none — `mountServer` is null for
    // that run, and the headline `wallMs` carries the comparison.
    let mountServer: RunResult["mountServer"] = null;
    if (protocol === "fuse") {
      const opsSnap = readOpStatsFromTempDirs();
      mountServer = {
        bytesServedOnPagesImg: opsSnap.bytesServedOnPagesImg,
        ops: opsSnap.ops,
        idleMs: wallMs - Math.floor(opsSnap.sumNs / 1e6),
        // Pull /tmp/perf-<pid>.map if --perf-basic-prof produced one.
        // The mount-server-bin pid is in the registry under
        // liveMounts; grab it before the VM stops.
        perfMap: grabPerfMap(opsSnap.mountServerPid, runId),
      };
    }

    result = {
      runId,
      host: hostInfo(),
      fixtures: { tarball: fixtureKey, tarballBytes },
      protocol,
      workload: tarCmd,
      wallMs,
      docker: null,
      mountServer,
    };
  } finally {
    await vm.kill().catch(() => {});
    await vm.wait().catch(() => undefined);
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {}
  }

  return result;
}

interface OpsSnapshot {
  bytesServedOnPagesImg: number;
  sumNs: number;
  ops: Record<string, OpHistogramShape>;
  mountServerPid: number | null;
}

interface StatsFileShape {
  bytesServedOnPagesImg?: number;
  ops?: Record<string, OpHistogramShape>;
}

function readOpStatsFromTempDirs(): OpsSnapshot {
  const empty: OpsSnapshot = {
    bytesServedOnPagesImg: 0,
    sumNs: 0,
    ops: {},
    mountServerPid: null,
  };
  const tmp = tmpdir();
  let candidates: string[];
  try {
    candidates = readdirSync(tmp).filter((name) => name.startsWith("machinen-vsock-"));
  } catch {
    return empty;
  }
  // Latest mtime wins — the run before this one may have left a stale
  // dir behind. The runtime cleans these up on stop() in the happy
  // path, but a crashed previous run can leave debris.
  const dirs = candidates
    .map((name) => {
      const full = join(tmp, name);
      try {
        return { full, mtimeMs: statSync(full).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((d): d is { full: string; mtimeMs: number } => d !== null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  let bytesServedOnPagesImg = 0;
  let sumNs = 0;
  const ops: Record<string, OpHistogramShape> = {};
  let foundAny = false;
  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir.full).filter(
        (n) => n.startsWith("live-mount-") && n.endsWith("-stats.json"),
      );
    } catch {
      continue;
    }
    if (files.length === 0) {
      continue;
    }
    foundAny = true;
    for (const file of files) {
      let snap: StatsFileShape;
      try {
        snap = JSON.parse(readFileSync(join(dir.full, file), "utf8")) as StatsFileShape;
      } catch {
        continue;
      }
      if (typeof snap.bytesServedOnPagesImg === "number") {
        bytesServedOnPagesImg += snap.bytesServedOnPagesImg;
      }
      if (snap.ops) {
        for (const [name, h] of Object.entries(snap.ops)) {
          sumNs += h.sumNs;
          const prev = ops[name];
          ops[name] = prev
            ? {
                count: prev.count + h.count,
                sumNs: prev.sumNs + h.sumNs,
                // Across-mount aggregation can't preserve true percentiles
                // without merging samples. For one-mount benches (the
                // common case) this is a passthrough; for multi-mount
                // we surface the max as an upper bound, which is honest.
                p50Ns: Math.max(prev.p50Ns, h.p50Ns),
                p99Ns: Math.max(prev.p99Ns, h.p99Ns),
              }
            : { ...h };
        }
      }
    }
    // Stop at the first dir with stats files — that's our VM's dir.
    if (foundAny) {
      break;
    }
  }
  // mountServerPid: probe /tmp/perf-*.map files newer than 60s. Best
  // effort — only needed for the perf map cp, not the histogram.
  const mountServerPid = guessMountServerPid();
  return { bytesServedOnPagesImg, sumNs, ops, mountServerPid };
}

function guessMountServerPid(): number | null {
  // /tmp/perf-<pid>.map is left by `node --perf-basic-prof`. We can't
  // reliably distinguish ours from another node process's; the bench
  // README explains the caveat. Pick the newest within 60s of now.
  try {
    const entries = readdirSync("/tmp").filter((n) => /^perf-\d+\.map$/.test(n));
    let best: { pid: number; mtimeMs: number } | null = null;
    const now = Date.now();
    for (const name of entries) {
      const full = join("/tmp", name);
      let mtimeMs: number;
      try {
        mtimeMs = statSync(full).mtimeMs;
      } catch {
        continue;
      }
      if (now - mtimeMs > 60_000) {
        continue;
      }
      const pid = Number.parseInt(name.slice(5, -4), 10);
      if (!Number.isFinite(pid)) {
        continue;
      }
      if (!best || mtimeMs > best.mtimeMs) {
        best = { pid, mtimeMs };
      }
    }
    return best?.pid ?? null;
  } catch {
    return null;
  }
}

function grabPerfMap(mountServerPid: number | null, runId: string): string | null {
  if (!mountServerPid) {
    return null;
  }
  const src = `/tmp/perf-${mountServerPid}.map`;
  if (!existsSync(src)) {
    return null;
  }
  const dst = join(RESULTS_DIR, `${runId}.perfmap`);
  try {
    renameSync(src, dst);
    return dst;
  } catch {
    return null;
  }
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
  console.log(`run: ${result.runId}   protocol: ${result.protocol}`);
  console.log(`host: ${result.host.os}/${result.host.arch} ${result.host.hostname}`);
  console.log("");
  console.log(`wall-clock tar-extract   ${(result.wallMs / 1000).toFixed(2)}s`);
  console.log(
    `docker baseline same     ${docker ? (docker / 1000).toFixed(2) + "s" : "(skipped)"}`,
  );
  console.log(`ratio ${result.protocol.padEnd(8)} / docker  ${ratio}×`);
  if (result.mountServer) {
    const handlerSumNs = Object.values(result.mountServer.ops).reduce((s, h) => s + h.sumNs, 0);
    const handlerFractionPct = ((handlerSumNs / 1e6 / result.wallMs) * 100).toFixed(1);
    console.log(`handler-time fraction    ${handlerFractionPct}%`);
    console.log(`idleMs                   ${result.mountServer.idleMs}ms`);
    const top = ["WRITE", "CREATE", "GETATTR", "LOOKUP", "RELEASE"];
    for (const op of top) {
      const h = result.mountServer.ops[op];
      if (!h) {
        continue;
      }
      console.log(
        `p50 ${op.padEnd(8)}            ${(h.p50Ns / 1000).toFixed(1)}µs   p99 ${(h.p99Ns / 1000).toFixed(1)}µs   n=${h.count}`,
      );
    }
  } else {
    // virtio-fs: the in-VMM device writes no stats file, so there's no
    // handler histogram — `wallMs` vs docker is the comparison.
    console.log(`handler stats            (n/a — in-VMM virtio-fs device)`);
  }
  console.log("");
  console.log(`result JSON:  scripts/bench/mount/results/${result.runId}.json`);
  if (result.mountServer?.perfMap) {
    console.log(`perf map:     ${result.mountServer.perfMap}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  const entry = loadFixture(args.fixtureKey);
  const tarballPath = await downloadAndVerify(entry);

  const result = await runJsServerBench(tarballPath, args.fixtureKey, args.protocol);

  if (!args.noDocker) {
    const dock = runDockerBaseline(tarballPath);
    if (dock) {
      result.docker = { wallMs: dock.wallMs };
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
