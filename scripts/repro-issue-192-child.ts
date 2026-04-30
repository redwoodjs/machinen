// One-VM child for the multi-process repro driver. The MP driver
// spawns N of these in parallel via plain shell `&` so each gets its
// own Node main thread (no boot() cache-prep serialization). On
// exit, prints one JSON line on stdout summarizing the run.
//
// Configured via env vars (keeps the bash driver simple):
//   REPRO_INDEX  numeric tag for log lines              (default 0)
//   REPRO_WATCH  seconds to keep the VM alive           (default 90)
//   REPRO_IMAGE  rootfs tarball path                    (default base rootfs)
//   REPRO_FUSE   "0" to skip the live mount             (default on)

import { boot } from "@machinen/runtime";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const ASSETS = join(REPO_ROOT, "release-assets");

const idx = Number(process.env.REPRO_INDEX ?? 0);
const watchSec = Number(process.env.REPRO_WATCH ?? 90);
const image = process.env.REPRO_IMAGE || join(ASSETS, "rootfs-debian-arm64.tar.gz");
const fuse = process.env.REPRO_FUSE !== "0";

const HIT_RE = /vmw_vsock_virtio_transport[^\n]*rx:id\s+(\d+)\s+is not a head!/;
const UPTIME_RE = /\[\s*([\d.]+)\]\s*[^\n]*rx:id\s+\d+\s+is not a head!/;

let hit = false;
let descId: number | undefined;
let uptime: number | undefined;
let tail = "";

const ticks = Math.max(1, Math.ceil(watchSec / 5));
const inner = fuse
  ? [
      `echo "[guest${idx}] booted uptime=$(awk '{print $1}' /proc/uptime)"`,
      `for i in $(seq 1 ${ticks}); do`,
      `  find /mnt/workspace -maxdepth 3 -type f >/dev/null 2>&1 || true`,
      `  sleep 5`,
      `done`,
      `echo "[guest${idx}] done uptime=$(awk '{print $1}' /proc/uptime)"`,
    ].join("\n")
  : `echo "[guest${idx}] booted"\nsleep ${watchSec}\necho done`;

const t0 = Date.now();
const vm = await boot({
  image,
  kernel: join(ASSETS, "Image-arm64"),
  dtb: join(ASSETS, "virt-arm64.dtb"),
  liveMounts: fuse ? [{ host: REPO_ROOT, guest: "/mnt/workspace", mode: "ro" }] : undefined,
  cmd: ["/bin/bash", "-lc", inner],
  timeoutMs: null,
  onLog: (evt) => {
    if (evt.source !== "guest-console") {
      return;
    }
    tail = (tail + evt.chunk.toString("utf8")).slice(-65536);
    if (!hit) {
      const m = HIT_RE.exec(tail);
      if (m) {
        hit = true;
        descId = Number(m[1]);
        const um = UPTIME_RE.exec(tail);
        if (um) {
          uptime = Number(um[1]);
        }
      }
    }
  },
});

const bootMs = Date.now() - t0;
process.stderr.write(`[child${idx}] booted pid=${vm.pid} bootMs=${bootMs}\n`);

const deadlineMs = (watchSec + 60) * 1000;
const killTimer = setTimeout(() => {
  vm.kill().catch(() => {});
}, deadlineMs);

let exitCode: number | null = null;
try {
  const exit = await vm.wait();
  exitCode = exit.code;
} catch {
  // killed by deadline — leave exitCode null
} finally {
  clearTimeout(killTimer);
}

console.log(
  JSON.stringify({
    index: idx,
    hit,
    descId,
    uptime,
    bootMs,
    exitCode,
    consoleTail: hit ? tail : undefined,
  }),
);
