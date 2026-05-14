# mount-server FUSE-over-vsock bench (#329)

Baseline-measures the current JS mount-server before any Zig port.

## What it measures

A bare `tar -xzf node-v24.x-linux-arm64.tar.gz` inside a machinen VM
with a `--mount-live rw` mount, against the same tarball extracted
inside `arm64v8/debian:12` on the host with a docker volume mount.

Three numbers come out:

1. **Wall-clock** for the tar extract — the user-visible number.
2. **Per-op latency histogram** — count, sumNs, p50, p99 for every
   FUSE op the kernel sent, surfaced via `LiveMountServerHandle.opStats()`
   when `MACHINEN_MOUNT_SERVER_PROFILE=1`.
3. **V8 flamegraph** from `node --perf-basic-prof` — Node writes a
   symbol map to `/tmp/perf-<pid>.map` that `perf script` / `node-perf`
   / a flamegraph tool can consume.

`idleMs = wallMs − sum(ops.sumNs)/1e6` separates _handler-bound_ runs
(where Zig might help) from _vsock-wire-bound_ runs (where it won't).

## How to run

```bash
# 1. Populate sha256 in fixtures.json (one-time per pinned tarball).
#    Cross-reference nodejs.org's SHASUMS256.txt and paste into the
#    sha256 field. Bench refuses to run with the placeholder.
curl -s https://nodejs.org/dist/v24.0.0/SHASUMS256.txt \
  | awk '/linux-arm64.tar.xz$/ {print $1}'

# 2. Run the bench. Downloads + caches the tarball on first run.
pnpm tsx scripts/bench/mount.ts

# 3. Inspect the result.
cat scripts/bench/mount/results/<runId>.json
```

The bench drives the docker baseline by shelling out to
`docker-baseline.sh`, so a docker daemon needs to be reachable. Skip
the docker side with `--no-docker` to get just the JS-server number.

## Reading the result

```
{
  "runId": "2026-05-14T…",
  "host": { ... },
  "fixtures": { "tarball": "node-24-linux-arm64", "fileCount": N },
  "workload": "tar -xzf …",
  "wallMs": N,
  "docker": { "wallMs": N },
  "mountServer": {
    "bytesServedOnPagesImg": 0,
    "ops": {
      "WRITE":   { "count": N, "sumNs": N, "p50Ns": N, "p99Ns": N },
      "CREATE":  { "...": "..." },
      ...
    },
    "idleMs": N,
    "perfMap": "scripts/bench/mount/results/<runId>.perfmap"
  }
}
```

`handlerFraction = sum(ops.sumNs) / (wallMs × 1e6)`. With handler
fraction high and idleMs low, the JS handler path dominates and
porting to Zig is the leverage. With idleMs high (most wall time is
between FUSE ops, not inside them), the bottleneck is on the wire
and the Zig port won't help.

## Results (2026-05-14, darwin/arm64, host=p4p8-3.local)

Comparison of the JS implementation that existed before #329 vs the
Zig-native server that replaced it. After-row is the mean of three runs.

| metric                 | JS (Before) | Zig (After) | speedup |
| ---------------------- | ----------- | ----------- | ------- |
| wall-clock tar-extract | 70.36s      | 4.41s       | 15.95×  |
| docker baseline same   | 2.29s       | 2.21s       | —       |
| ratio impl / docker    | 30.66×      | 1.99×       | —       |
| handler-time fraction  | 88.2%       | 14.3%       | —       |
| WRITE count            | 39,873      | 5,529       | —       |

Per-op p50/p99 are unpopulated by the Zig server in this PR (`count`
and `sumNs` only, no percentile ring) — follow-up.

Two changes drove the gain:

1. **Zig port itself** — handler-fraction dropped from 88.2% to ~14%.
   The userspace cost of every op shrank to sub-µs (vs ~50µs each in
   v8/libuv).
2. **`FUSE_CAP_WRITEBACK_CACHE`** in the INIT reply — the guest
   kernel coalesces tar's 39 k tiny `write(2)` calls into ~5 k
   max-write-sized FUSE WRITE ops. The JS server explicitly masked
   this flag off, so wire-write count was the largest single
   contributor to the remaining gap. Enabled here with the caveats
   documented in `packages/mount-server/src/main.zig`'s INIT handler.

`Zig / docker = 1.99×` lands under the #329 acceptance bar (`≤ 2×`).

The remaining ~2× to docker is on the FUSE-over-vsock wire (vsock RTT,
kernel FUSE driver overhead, guest fuse-agent byte-pump). That's a
separate "shrink the wire" track — see #332 for the virtio-fs follow-up
which would beat docker outright.

## PR description template

```
| metric                  | JS (Before) | Zig (After) | speedup |
|-------------------------|-------------|-------------|---------|
| wall-clock tar-extract  | …s          | …s          | …×      |
| docker baseline same    | …s          | …s          | —       |
| ratio impl / docker     | …×          | …×          | —       |
| handler-time fraction   | …%          | …%          | —       |
| p50 WRITE               | …µs         | …µs         | …×      |
| p99 WRITE               | …µs         | …µs         | …×      |
| p50 CREATE              | …µs         | …µs         | …×      |
| p99 CREATE              | …µs         | …µs         | …×      |
| top 3 flamegraph frames | …, …, …     | …, …, …     |         |
```
