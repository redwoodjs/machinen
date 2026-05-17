// Concurrent-boot reproduction for issue #192:
// "guest virtio_ring: rx:id N is not a head!"
//
// Boots N microVMs (concurrent by default; --serial as control), each
// running a minimal cmd that idles + touches the FUSE live mount to
// keep vsock traffic flowing. Watches each guest's kernel console for
//
//     vmw_vsock_virtio_transport virtio<N>: rx:id <id> is not a head!
//
// and reports per-VM hits + aggregate hit rate. Use it to measure how
// the warning's frequency tracks concurrency (the hypothesis from the
// triage thread on the issue).
//
// Usage:
//   node scripts/repro-issue-192.ts                   # n=8 concurrent, base rootfs
//   node scripts/repro-issue-192.ts --n 16            # 16 in parallel
//   node scripts/repro-issue-192.ts --n 4 --serial    # control: one at a time
//   node scripts/repro-issue-192.ts --watch 120       # watch each VM for 120s
//   node scripts/repro-issue-192.ts --image ~/.cache/machinen/machinen/app.tar.gz
//   node scripts/repro-issue-192.ts --no-fuse         # boot without a live mount
//
// Output per VM: HIT (warning seen, with desc id + guest uptime) /
// wedged (cmd still running past deadline; vsock probably stuck) /
// ok (cmd ran to completion). On HIT or wedge, the last 64 KiB of the
// guest console is dumped so you can inspect what fired.
//
// Caveats:
//   - The bug is intermittent — a single clean run does NOT mean the
//     bug is gone. Repeat the run; vary `--n` and `--watch`.
//   - With `--image app.tar.gz` (5+ GiB per VM) and high `--n`,
//     wedges may be host memory-thrashing rather than the rx:id bug.
//     Cross-check the captured console tail for the exact printk.
//
// Exit codes: 0 ran cleanly (regardless of hit/no-hit). 2 script error.

import { boot } from "@machinen/runtime";
import type { BootOptions, OnLog, VmHandle } from "@machinen/runtime";
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ASSETS = join(REPO_ROOT, "release-assets");
const KERNEL = join(ASSETS, "Image-arm64");
const DTB = join(ASSETS, "virt-arm64.dtb");
const DEFAULT_IMAGE = join(ASSETS, "rootfs-debian-arm64.tar.gz");

interface Args {
  n: number;
  serial: boolean;
  watchSec: number;
  image: string;
  fuse: boolean;
}

const USAGE =
  "Usage: node scripts/repro-issue-192.ts [--n N] [--serial] [--watch S] [--image PATH] [--no-fuse]";

interface ParseContext {
  argv: string[];
  args: Args;
  index: number;
}

type ArgHandler = (ctx: ParseContext) => void;

const ARG_HANDLERS: Record<string, ArgHandler> = {
  "--n": (ctx) => {
    ctx.args.n = Number(takeOptionValue(ctx, "--n"));
  },
  "--serial": (ctx) => {
    ctx.args.serial = true;
  },
  "--watch": (ctx) => {
    ctx.args.watchSec = Number(takeOptionValue(ctx, "--watch"));
  },
  "--image": (ctx) => {
    ctx.args.image = takeOptionValue(ctx, "--image");
  },
  "--no-fuse": (ctx) => {
    ctx.args.fuse = false;
  },
  "-h": () => printUsageAndExit(),
  "--help": () => printUsageAndExit(),
};

function parseArgs(): Args {
  const ctx: ParseContext = { argv: process.argv.slice(2), args: defaultArgs(), index: 0 };
  for (; ctx.index < ctx.argv.length; ctx.index++) {
    applyArg(ctx);
  }
  validateArgs(ctx.args);
  return ctx.args;
}

function defaultArgs(): Args {
  return {
    n: 8,
    serial: false,
    watchSec: 90,
    image: DEFAULT_IMAGE,
    fuse: true,
  };
}

function applyArg(ctx: ParseContext): void {
  const arg = ctx.argv[ctx.index];
  const handler = ARG_HANDLERS[arg];
  if (!handler) {
    exitArgError(`repro-192: unknown arg: ${arg}`);
  }
  handler(ctx);
}

function takeOptionValue(ctx: ParseContext, name: string): string {
  const value = ctx.argv[++ctx.index];
  if (value === undefined) {
    exitArgError(`repro-192: ${name} requires a value`);
  }
  return value;
}

function printUsageAndExit(): never {
  console.log(USAGE);
  process.exit(0);
}

function validateArgs(out: Args): void {
  assertNumericArg("--n", out.n, 1);
  assertNumericArg("--watch", out.watchSec, 5);
}

function assertNumericArg(name: string, value: number, min: number): void {
  if (!Number.isFinite(value) || value < min) {
    exitArgError(`repro-192: ${name} must be >= ${min} (got ${value})`);
  }
}

function exitArgError(message: string): never {
  console.error(message);
  process.exit(2);
}

const args = parseArgs();

for (const f of [args.image, KERNEL, DTB]) {
  if (!existsSync(f)) {
    console.error(`repro-192: missing ${f}`);
    console.error(
      "           build base assets first: scripts/build-base-assets.sh (or `pnpm provision` for app.tar.gz)",
    );
    process.exit(2);
  }
}

// Match vm.ts's formula but a bit more conservative — repro doesn't
// need the inflate headroom, and N copies of the boot RAM has to fit
// on the host. Floor of 2 GiB still leaves the kernel + tmpfs comfy.
function ramForImage(path: string): number {
  const compressed = statSync(path).size;
  const GIB = 1024 ** 3;
  const raw = Math.max(2 * GIB, compressed * 8 + GIB);
  const align = 256 * 1024 * 1024;
  return Math.ceil(raw / align) * align;
}
const RAM = ramForImage(args.image);

// `[   46.966932] vmw_vsock_virtio_transport virtio2: rx:id 164 is not a head!`
const HIT_RE = /vmw_vsock_virtio_transport[^\n]*rx:id\s+(\d+)\s+is not a head!/;
const UPTIME_RE = /\[\s*([\d.]+)\]\s*[^\n]*rx:id\s+\d+\s+is not a head!/;

interface Result {
  index: number;
  pid?: number;
  bootMs?: number;
  hit: boolean;
  hitAtMs?: number;
  guestUptimeAtHit?: number;
  descId?: number;
  exitCode?: number | null;
  killed?: boolean;
  error?: string;
  consoleTail?: string;
}

interface ConsoleTailBuffer {
  text: string;
}

interface ParsedHit {
  descId: number;
  guestUptimeAtHit?: number;
}

async function runOne(index: number): Promise<Result> {
  const result: Result = { index, hit: false };
  const startedAt = Date.now();
  const tail: ConsoleTailBuffer = { text: "" };
  const vm = await bootReproVm(index, result, startedAt, tail);
  if (!vm) {
    return result;
  }
  recordBootSuccess(result, vm, startedAt);
  await waitForVmWithDeadline(vm, index, result);
  attachDiagnosticTail(result, tail);
  return result;
}

async function bootReproVm(
  index: number,
  result: Result,
  startedAt: number,
  tail: ConsoleTailBuffer,
): Promise<VmHandle | undefined> {
  try {
    return await boot(buildBootOptions(index, result, startedAt, tail));
  } catch (err) {
    result.error = errorMessage(err);
    console.error(`[vm${index}] BOOT FAILED: ${result.error}`);
    return undefined;
  }
}

function buildBootOptions(
  index: number,
  result: Result,
  startedAt: number,
  tail: ConsoleTailBuffer,
): BootOptions {
  return {
    image: args.image,
    kernel: KERNEL,
    dtb: DTB,
    liveMounts: liveMountsForRun(),
    cmd: ["/bin/bash", "-lc", buildInnerCommand(index)],
    timeoutMs: null,
    vmmEnv: { MACHINEN_RAM_BYTES: String(RAM) },
    onLog: createReproLogHandler(index, result, startedAt, tail),
  };
}

function liveMountsForRun(): BootOptions["liveMounts"] {
  return args.fuse ? [{ host: REPO_ROOT, guest: "/mnt/workspace", mode: "ro" }] : undefined;
}

function buildInnerCommand(index: number): string {
  return args.fuse ? buildFuseTrafficCommand(index) : buildSleepOnlyCommand(index);
}

function buildFuseTrafficCommand(index: number): string {
  const tickSec = 5;
  const ticks = Math.max(1, Math.ceil(args.watchSec / tickSec));
  return [
    `echo "[guest${index}] booted uptime=$(awk '{print $1}' /proc/uptime)"`,
    `for i in $(seq 1 ${ticks}); do`,
    `  find /mnt/workspace -maxdepth 3 -type f >/dev/null 2>&1 || true`,
    `  sleep ${tickSec}`,
    `done`,
    `echo "[guest${index}] done uptime=$(awk '{print $1}' /proc/uptime)"`,
  ].join("\n");
}

function buildSleepOnlyCommand(index: number): string {
  return `echo "[guest${index}] booted"\nsleep ${args.watchSec}\necho "[guest${index}] done"`;
}

function createReproLogHandler(
  index: number,
  result: Result,
  startedAt: number,
  tail: ConsoleTailBuffer,
): OnLog {
  return (evt) => {
    if (evt.source !== "guest-console") {
      return;
    }
    appendConsoleTail(tail, evt.chunk);
    recordFirstHit(index, result, startedAt, tail.text);
  };
}

function appendConsoleTail(tail: ConsoleTailBuffer, chunk: Buffer): void {
  tail.text = (tail.text + chunk.toString("utf8")).slice(-65536);
}

function recordFirstHit(index: number, result: Result, startedAt: number, tail: string): void {
  if (result.hit) {
    return;
  }
  const hit = parseHit(tail);
  if (!hit) {
    return;
  }
  result.hit = true;
  result.descId = hit.descId;
  result.guestUptimeAtHit = hit.guestUptimeAtHit;
  result.hitAtMs = Date.now() - startedAt;
  console.error(
    `[vm${index}] HIT  desc=${result.descId} uptime=${result.guestUptimeAtHit ?? "?"}s wall=${(result.hitAtMs / 1000).toFixed(1)}s`,
  );
}

function parseHit(tail: string): ParsedHit | undefined {
  const match = HIT_RE.exec(tail);
  if (!match) {
    return undefined;
  }
  const uptime = UPTIME_RE.exec(tail)?.[1];
  return {
    descId: Number(match[1]),
    guestUptimeAtHit: uptime === undefined ? undefined : Number(uptime),
  };
}

function recordBootSuccess(result: Result, vm: VmHandle, startedAt: number): void {
  result.pid = vm.pid;
  result.bootMs = Date.now() - startedAt;
  console.error(`[vm${result.index}] booted pid=${vm.pid} in ${result.bootMs}ms`);
}

async function waitForVmWithDeadline(vm: VmHandle, index: number, result: Result): Promise<void> {
  const killTimer = armDeadline(vm, index, result);
  try {
    const exit = await vm.wait();
    result.exitCode = exit.code;
  } catch (err) {
    result.error = errorMessage(err);
  } finally {
    clearTimeout(killTimer);
  }
}

function armDeadline(vm: VmHandle, index: number, result: Result): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    result.killed = true;
    console.error(`[vm${index}] deadline exceeded — killing`);
    vm.kill().catch(() => {});
  }, deadlineMs());
}

function deadlineMs(): number {
  return (args.watchSec + 60) * 1000;
}

function attachDiagnosticTail(result: Result, tail: ConsoleTailBuffer): void {
  if (shouldIncludeConsoleTail(result)) {
    result.consoleTail = tail.text;
  }
}

function shouldIncludeConsoleTail(result: Result): boolean {
  return result.hit || Boolean(result.killed) || Boolean(result.error);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  printRunHeader();
  const startedAt = Date.now();
  const results = await runBatch();
  printSummary(results, elapsedSeconds(startedAt));
}

function printRunHeader(): void {
  console.error(
    `repro-192: n=${args.n} mode=${modeLabel()} ` +
      `watch=${args.watchSec}s fuse=${args.fuse} image=${args.image}`,
  );
  console.error(`repro-192: per-vm ram=${(RAM / 1024 ** 3).toFixed(1)} GiB`);
}

async function runBatch(): Promise<Result[]> {
  return args.serial ? runSerialBatch() : runConcurrentBatch();
}

async function runSerialBatch(): Promise<Result[]> {
  const results: Result[] = [];
  for (let i = 0; i < args.n; i++) {
    results.push(await runOne(i));
  }
  return results;
}

async function runConcurrentBatch(): Promise<Result[]> {
  return Promise.all(Array.from({ length: args.n }, (_, i) => runOne(i)));
}

function elapsedSeconds(startedAt: number): number {
  return (Date.now() - startedAt) / 1000;
}

function printSummary(results: Result[], elapsedSec: number): void {
  const counts = countOutcomes(results);
  console.log("");
  console.log("=== repro-192 summary ===");
  console.log(`n=${args.n} mode=${modeLabel()} elapsed=${elapsedSec.toFixed(1)}s`);
  console.log(
    `hits=${counts.hits}/${args.n} (${hitPercent(counts.hits)}%) ` +
      `wedged=${counts.killed} bootFailed=${counts.bootFailed}`,
  );
  printResultLines(results);
  printConsoleTails(results);
}

function countOutcomes(results: Result[]): { hits: number; bootFailed: number; killed: number } {
  return {
    hits: results.filter((r) => r.hit).length,
    bootFailed: results.filter((r) => r.error && !r.pid).length,
    killed: results.filter((r) => r.killed).length,
  };
}

function hitPercent(hits: number): string {
  return ((hits / args.n) * 100).toFixed(0);
}

function printResultLines(results: Result[]): void {
  for (const result of results) {
    console.log(`  vm${result.index}: ${resultTag(result)}${bootMsSuffix(result)}`);
  }
}

function resultTag(result: Result): string {
  if (result.error) {
    return `ERR ${result.error}`;
  }
  if (result.hit) {
    return `HIT  desc=${result.descId} uptime=${result.guestUptimeAtHit ?? "?"}s${wedgeSuffix(result)}`;
  }
  return `ok   exit=${result.exitCode}${wedgeSuffix(result)}`;
}

function bootMsSuffix(result: Result): string {
  return result.bootMs ? `  bootMs=${result.bootMs}` : "";
}

function wedgeSuffix(result: Result): string {
  return result.killed ? " (wedged past deadline)" : "";
}

function printConsoleTails(results: Result[]): void {
  for (const result of results) {
    printConsoleTail(result);
  }
}

function printConsoleTail(result: Result): void {
  if (!result.consoleTail) {
    return;
  }
  console.log("");
  console.log(`--- vm${result.index} console tail (last ${result.consoleTail.length} bytes) ---`);
  console.log(result.consoleTail.trimEnd());
}

function modeLabel(): string {
  return args.serial ? "serial" : "concurrent";
}

main().catch((err) => {
  console.error("repro-192: fatal", err);
  process.exit(2);
});
