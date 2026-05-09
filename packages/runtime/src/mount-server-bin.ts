// Standalone entry point for the live-share mount server (#150
// phase 3). The runtime supervisor spawns this as a separate process
// (wrapped through pdeathsig --watch-pid <vmm-pid>) so the supervisor
// can exit cleanly while the mount server keeps serving FUSE traffic
// for the still-running VMM.
//
// Argv:
//
//   node mount-server-bin.js \
//     --uds   /path/to/live-mount-N.sock \
//     --root  /host/path/that/the/guest/sees \
//     --mode  ro|rw \
//     --stats /path/to/stats.json
//
// The `--stats` path is where this process publishes its
// bytesServedOnPagesImg counter so the (possibly different) supervisor
// or attach process can read it back via vm.memoryStats(). Atomic via
// tmp+rename to avoid torn JSON reads.
//
// Exits cleanly on SIGTERM / SIGINT: closes the listener, drains
// in-flight handles, flushes one final stats write.
//
// This file is built as a second tsup entry (dist/mount-server-bin.js).
// Tests run it via tsx so the .ts source is the source of truth in dev.

import { renameSync, writeFileSync, unlinkSync } from "node:fs";
import { serveLiveMount } from "./mount-server.ts";

interface ParsedArgs {
  uds: string;
  root: string;
  mode: "ro" | "rw";
  stats: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: Partial<ParsedArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`missing value for ${flag}`);
    }
    switch (flag) {
      case "--uds":
        out.uds = value;
        i++;
        break;
      case "--root":
        out.root = value;
        i++;
        break;
      case "--mode":
        if (value !== "ro" && value !== "rw") {
          throw new Error(`--mode must be 'ro' or 'rw' (got '${value}')`);
        }
        out.mode = value;
        i++;
        break;
      case "--stats":
        out.stats = value;
        i++;
        break;
      default:
        throw new Error(`unknown flag '${flag}'`);
    }
  }
  for (const key of ["uds", "root", "mode", "stats"] as const) {
    if (out[key] === undefined) {
      throw new Error(`missing required --${key}`);
    }
  }
  return out as ParsedArgs;
}

// Stats file shape: small, single-object, future-extensible.
interface StatsSnapshot {
  bytesServedOnPagesImg: number;
  // Wall-clock timestamp the snapshot was written, milliseconds since
  // the unix epoch. The reader doesn't currently consult it but it
  // makes a `cat stats.json` debuggable.
  updatedAtMs: number;
}

function writeStatsAtomic(path: string, snapshot: StatsSnapshot): void {
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(snapshot));
  renameSync(tmp, path);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const handle = await serveLiveMount(args.uds, {
    rootAbs: args.root,
    mode: args.mode,
  });

  // Write an initial zero so the reader sees a valid file before any
  // FUSE traffic arrives. Otherwise vm.memoryStats() during early boot
  // would race the first periodic write.
  writeStatsAtomic(args.stats, {
    bytesServedOnPagesImg: 0,
    updatedAtMs: Date.now(),
  });

  // Publish on a 250ms tick. Skips the rename if the counter hasn't
  // moved — a steady-state mount with no faults stays quiet. The
  // counter is monotonically non-decreasing so a strict-greater check
  // is sufficient.
  let lastPublished = 0;
  const ticker = setInterval(() => {
    const cur = handle.bytesServedOnPagesImg();
    if (cur === lastPublished) {
      return;
    }
    lastPublished = cur;
    try {
      writeStatsAtomic(args.stats, {
        bytesServedOnPagesImg: cur,
        updatedAtMs: Date.now(),
      });
    } catch {
      // Best-effort. A failure here just means the reader sees a
      // slightly stale value next read.
    }
  }, 250);
  // Don't pin the event loop on the timer — process stays alive via
  // the listening socket, and timers should not delay shutdown.
  ticker.unref();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    clearInterval(ticker);
    try {
      // One final stats flush so the reader gets the closing value.
      writeStatsAtomic(args.stats, {
        bytesServedOnPagesImg: handle.bytesServedOnPagesImg(),
        updatedAtMs: Date.now(),
      });
    } catch {}
    try {
      await handle.stop();
    } catch {}
    try {
      // Best-effort cleanup. The supervisor's stop() also rms these
      // for the case where this process was kill -9'd before reaching
      // the handler.
      unlinkSync(args.stats);
    } catch {}
    // Re-raise the signal as the exit code so callers that look at
    // WTERMSIG see what they sent.
    process.exit(signal === "SIGTERM" ? 0 : 128 + (signalToNumber(signal) ?? 15));
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
}

function signalToNumber(signal: NodeJS.Signals): number | undefined {
  // Node doesn't expose os.constants.signals as a typed const here,
  // but the three signals we register all have well-known numbers on
  // POSIX. Hard-coded to avoid pulling in os.constants.
  switch (signal) {
    case "SIGTERM":
      return 15;
    case "SIGINT":
      return 2;
    case "SIGHUP":
      return 1;
    default:
      return undefined;
  }
}

main().catch((err) => {
  process.stderr.write(`mount-server-bin: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
