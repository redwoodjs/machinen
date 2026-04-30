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

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const out: Args = {
    n: 8,
    serial: false,
    watchSec: 90,
    image: DEFAULT_IMAGE,
    fuse: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--n") {
      out.n = Number(argv[++i]);
    } else if (a === "--serial") {
      out.serial = true;
    } else if (a === "--watch") {
      out.watchSec = Number(argv[++i]);
    } else if (a === "--image") {
      out.image = argv[++i];
    } else if (a === "--no-fuse") {
      out.fuse = false;
    } else if (a === "-h" || a === "--help") {
      console.log(
        "Usage: node scripts/repro-issue-192.ts [--n N] [--serial] [--watch S] [--image PATH] [--no-fuse]",
      );
      process.exit(0);
    } else {
      console.error(`repro-192: unknown arg: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isFinite(out.n) || out.n < 1) {
    console.error(`repro-192: --n must be >= 1 (got ${out.n})`);
    process.exit(2);
  }
  if (!Number.isFinite(out.watchSec) || out.watchSec < 5) {
    console.error(`repro-192: --watch must be >= 5 (got ${out.watchSec})`);
    process.exit(2);
  }
  return out;
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

async function runOne(index: number): Promise<Result> {
  const result: Result = { index, hit: false };
  const t0 = Date.now();

  // Inside-guest cmd. With FUSE: poll the live mount to keep vsock
  // traffic flowing, since the warning correlates with vsock load.
  // Without FUSE: just sleep — the agent (winsize, exec) on vsock
  // still does its periodic chatter.
  const tickSec = 5;
  const ticks = Math.max(1, Math.ceil(args.watchSec / tickSec));
  const inner = args.fuse
    ? [
        `echo "[guest${index}] booted uptime=$(awk '{print $1}' /proc/uptime)"`,
        `for i in $(seq 1 ${ticks}); do`,
        `  find /mnt/workspace -maxdepth 3 -type f >/dev/null 2>&1 || true`,
        `  sleep ${tickSec}`,
        `done`,
        `echo "[guest${index}] done uptime=$(awk '{print $1}' /proc/uptime)"`,
      ].join("\n")
    : `echo "[guest${index}] booted"\nsleep ${args.watchSec}\necho "[guest${index}] done"`;

  let tail = "";

  let vm;
  try {
    vm = await boot({
      image: args.image,
      kernel: KERNEL,
      dtb: DTB,
      liveMounts: args.fuse
        ? [{ host: REPO_ROOT, guest: "/mnt/workspace", mode: "ro" }]
        : undefined,
      cmd: ["/bin/bash", "-lc", inner],
      timeoutMs: null,
      vmmEnv: { MACHINEN_RAM_BYTES: String(RAM) },
      onLog: (evt) => {
        if (evt.source !== "guest-console") {
          return;
        }
        tail = (tail + evt.chunk.toString("utf8")).slice(-65536);
        if (!result.hit) {
          const m = HIT_RE.exec(tail);
          if (m) {
            result.hit = true;
            result.descId = Number(m[1]);
            result.hitAtMs = Date.now() - t0;
            const um = UPTIME_RE.exec(tail);
            if (um) {
              result.guestUptimeAtHit = Number(um[1]);
            }
            console.error(
              `[vm${index}] HIT  desc=${result.descId} uptime=${result.guestUptimeAtHit ?? "?"}s wall=${(result.hitAtMs / 1000).toFixed(1)}s`,
            );
          }
        }
      },
    });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    console.error(`[vm${index}] BOOT FAILED: ${result.error}`);
    return result;
  }
  result.pid = vm.pid;
  result.bootMs = Date.now() - t0;
  console.error(`[vm${index}] booted pid=${vm.pid} in ${result.bootMs}ms`);

  // Hard deadline: cmd should self-terminate after watchSec, and
  // /init poweroffs after that. Wedged vsock can leave the cmd
  // hanging even though the warning fired, so kill if it overruns.
  const deadlineMs = (args.watchSec + 60) * 1000;
  const killTimer = setTimeout(() => {
    result.killed = true;
    console.error(`[vm${index}] deadline exceeded — killing`);
    vm.kill().catch(() => {});
  }, deadlineMs);

  try {
    const exit = await vm.wait();
    result.exitCode = exit.code;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    clearTimeout(killTimer);
  }
  // Snapshot the console tail for diagnosis: only useful when something
  // weird happened (hit, wedge, or boot error). Skip for clean exits to
  // keep the report compact.
  if (result.hit || result.killed || result.error) {
    result.consoleTail = tail;
  }
  return result;
}

async function main(): Promise<void> {
  console.error(
    `repro-192: n=${args.n} mode=${args.serial ? "serial" : "concurrent"} ` +
      `watch=${args.watchSec}s fuse=${args.fuse} image=${args.image}`,
  );
  console.error(`repro-192: per-vm ram=${(RAM / 1024 ** 3).toFixed(1)} GiB`);

  const t0 = Date.now();
  const results: Result[] = [];
  if (args.serial) {
    for (let i = 0; i < args.n; i++) {
      results.push(await runOne(i));
    }
  } else {
    const settled = await Promise.all(Array.from({ length: args.n }, (_, i) => runOne(i)));
    results.push(...settled);
  }
  const elapsedSec = (Date.now() - t0) / 1000;

  const hits = results.filter((r) => r.hit);
  const bootFailed = results.filter((r) => r.error && !r.pid);
  const killed = results.filter((r) => r.killed);

  console.log("");
  console.log("=== repro-192 summary ===");
  console.log(
    `n=${args.n} mode=${args.serial ? "serial" : "concurrent"} elapsed=${elapsedSec.toFixed(1)}s`,
  );
  console.log(
    `hits=${hits.length}/${args.n} (${((hits.length / args.n) * 100).toFixed(0)}%) ` +
      `wedged=${killed.length} bootFailed=${bootFailed.length}`,
  );
  for (const r of results) {
    const tag = r.error
      ? `ERR ${r.error}`
      : r.hit
        ? `HIT  desc=${r.descId} uptime=${r.guestUptimeAtHit ?? "?"}s` +
          (r.killed ? " (wedged past deadline)" : "")
        : `ok   exit=${r.exitCode}` + (r.killed ? " (wedged past deadline)" : "");
    console.log(`  vm${r.index}: ${tag}` + (r.bootMs ? `  bootMs=${r.bootMs}` : ""));
  }

  for (const r of results) {
    if (r.consoleTail) {
      console.log("");
      console.log(`--- vm${r.index} console tail (last ${r.consoleTail.length} bytes) ---`);
      console.log(r.consoleTail.trimEnd());
    }
  }
}

main().catch((err) => {
  console.error("repro-192: fatal", err);
  process.exit(2);
});
