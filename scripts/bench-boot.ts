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
//   gvproxy install / artifact-cache / initramfs-pack are NOT cleared:
//   their per-boot cost is what we want to measure here.
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

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = { n: 5, mode: "boot", coldOnly: false, warmOnly: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--n" || a === "-n") {
      out.n = Number.parseInt(argv[++i] ?? "", 10);
    } else if (a.startsWith("--n=")) {
      out.n = Number.parseInt(a.slice(4), 10);
    } else if (a === "--mode") {
      out.mode = argv[++i] as Mode;
    } else if (a.startsWith("--mode=")) {
      out.mode = a.slice(7) as Mode;
    } else if (a === "--cold-only") {
      out.coldOnly = true;
    } else if (a === "--warm-only") {
      out.warmOnly = true;
    } else if (a === "-h" || a === "--help") {
      printUsageAndExit(0);
    } else {
      console.error(`bench-boot: unknown arg ${a}`);
      printUsageAndExit(2);
    }
  }
  if (!Number.isInteger(out.n) || out.n < 1) {
    console.error(`bench-boot: --n must be a positive integer (got ${out.n})`);
    process.exit(2);
  }
  if (out.mode !== "boot" && out.mode !== "restore") {
    console.error(`bench-boot: --mode must be 'boot' or 'restore' (got ${out.mode})`);
    process.exit(2);
  }
  if (out.coldOnly && out.warmOnly) {
    console.error("bench-boot: --cold-only and --warm-only are mutually exclusive");
    process.exit(2);
  }
  return out;
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
  const idx = line.indexOf("phases ");
  if (idx < 0) {
    return null;
  }
  const tail = line.slice(idx + "phases ".length).trim();
  const tokens = tail.split(/\s+/);
  let kind = "";
  let total = -1;
  const phases = new Map<string, number>();
  for (const t of tokens) {
    const eq = t.indexOf("=");
    if (eq < 0) {
      return null;
    }
    const k = t.slice(0, eq);
    const v = t.slice(eq + 1);
    if (k === "kind") {
      kind = v;
    } else if (k === "total") {
      total = Number.parseInt(v, 10);
    } else {
      const n = Number.parseInt(v, 10);
      if (Number.isFinite(n)) {
        phases.set(k, n);
      }
    }
  }
  if (!kind || total < 0) {
    return null;
  }
  return { kind, total, phases };
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
  const captured = lines.join("");
  const found: PhaseLine[] = [];
  for (const ln of captured.split("\n")) {
    const parsed = parsePhaseLine(ln);
    if (parsed && (parsed.kind === "boot" || parsed.kind === "restore")) {
      found.push(parsed);
    }
  }
  return found;
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
  const med = sorted[Math.floor(n / 2)] ?? 0;
  const p95 = sorted[Math.min(n - 1, Math.floor(n * 0.95))] ?? 0;
  const sum = sorted.reduce((s, x) => s + x, 0);
  return { n, min: sorted[0] ?? 0, med, p95, max: sorted[n - 1] ?? 0, sum };
}

function aggregate(label: string, runs: PhaseLine[]): void {
  if (runs.length === 0) {
    console.log(`\n=== ${label} (no runs) ===`);
    return;
  }
  // Union of phase keys, in first-run order so the table reads as a timeline.
  const keys: string[] = ["total"];
  const seen = new Set<string>(["total"]);
  for (const r of runs) {
    for (const k of r.phases.keys()) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  console.log(`\n=== ${label} (n=${runs.length}) ===`);
  console.log(`  ${"phase".padEnd(28)}  min   med   p95   max  (ms)`);
  for (const k of keys) {
    const samples: number[] = [];
    for (const r of runs) {
      const v = k === "total" ? r.total : r.phases.get(k);
      if (typeof v === "number") {
        samples.push(v);
      }
    }
    if (samples.length === 0) {
      continue;
    }
    const s = stats(samples);
    console.log(
      `  ${k.padEnd(28)}  ${String(s.min).padStart(4)}  ${String(s.med).padStart(4)}  ${String(s.p95).padStart(4)}  ${String(s.max).padStart(4)}`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  requireAssets();

  if (args.mode === "boot") {
    const cold: PhaseLine[] = [];
    const warm: PhaseLine[] = [];
    if (!args.warmOnly) {
      for (let i = 0; i < args.n; i++) {
        clearRootfsImgCache();
        cold.push(await runOneBoot(`cold-${i + 1}`));
      }
    }
    if (!args.coldOnly) {
      // Warm = cache populated. Run one priming boot first if we just
      // wiped it (cold pass), then N measured warm runs.
      if (!args.warmOnly) {
        // The last cold pass already populated the cache; that's our prime.
      } else {
        // Prime explicitly so the first warm run isn't accidentally cold.
        await runOneBoot("warm-prime");
      }
      for (let i = 0; i < args.n; i++) {
        warm.push(await runOneBoot(`warm-${i + 1}`));
      }
    }
    if (cold.length) {
      aggregate("BOOT (cold)", cold);
    }
    if (warm.length) {
      aggregate("BOOT (warm)", warm);
    }
    return;
  }

  // Restore mode.
  let snapDir: string | undefined;
  try {
    snapDir = await takeSnapshot();
    if (!existsSync(join(snapDir, "disk.img"))) {
      throw new Error(`takeSnapshot did not produce ${snapDir}/disk.img`);
    }
    const cold: PhaseLine[] = [];
    const warm: PhaseLine[] = [];
    const collect = (out: PhaseLine[], lines: PhaseLine[]) => {
      const r = lines.find((l) => l.kind === "restore");
      if (r) {
        out.push(r);
      }
    };
    if (!args.warmOnly) {
      for (let i = 0; i < args.n; i++) {
        clearRootfsImgCache();
        collect(cold, await runOneRestore(snapDir, `cold-${i + 1}`));
      }
    }
    if (!args.coldOnly) {
      if (args.warmOnly) {
        await runOneRestore(snapDir, "warm-prime");
      }
      for (let i = 0; i < args.n; i++) {
        collect(warm, await runOneRestore(snapDir, `warm-${i + 1}`));
      }
    }
    if (cold.length) {
      aggregate("RESTORE (cold)", cold);
    }
    if (warm.length) {
      aggregate("RESTORE (warm)", warm);
    }
  } finally {
    if (snapDir && existsSync(snapDir)) {
      try {
        rmSync(snapDir, { recursive: true, force: true });
      } catch {}
    }
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("bench-boot failed:", err instanceof Error ? err.stack || err.message : err);
    process.exit(3);
  },
);
