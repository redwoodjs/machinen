# live-mount bench (#329, #332, #338)

Times a `tar -xzf` inside a machinen VM through a `--mount-live` mount,
against the same extract under docker. The current harness also records
extra decomposed phases so we can split host speed, guest rootfs speed,
live-read cost, live-write cost, metadata cost, a batch-apply estimate,
and large sequential write cost.

Started as the #329 baseline (JS mount-server → Zig port), then tracked
the #332 virtio-fs transport. #338 removed the FUSE-over-vsock transport
entirely, so there is now a single live-mount path: the in-VMM virtio-fs
device. The bench reports wall-clock vs docker.

## What it measures

A bare `tar -xzf node-v24.x-linux-arm64.tar.gz` inside a machinen VM
with a `--mount-live rw` mount, against the same tarball extracted
inside `arm64v8/debian:12` on the host with a docker volume mount.

The primary numbers are:

1. **Wall-clock** for the current live-read + live-write tar extract —
   the user-visible number kept as `wallMs` / `phases.tarExtractMs`.
2. **docker baseline** wall-clock for the same extract, when docker is
   available.
3. **decomposed phases** for host native extract, guest rootfs extract,
   live-read-only extract, live-write-only extract, the current
   live-read + live-write extract, small-file metadata, a host-side
   batch apply estimate, and large sequential write.

The in-VMM virtio-fs device runs synchronously on the VMM thread. The
benchmark phases split the workload before deeper per-op profiling is
used to explain a specific bottleneck. The batch estimate is an
upper-bound shape for the product `:batch` mode: it extracts the tree on
guest-local storage, streams that tree back as one tar, and extracts it
natively on the host, without measuring the full product sync wrapper or
conflict semantics.

## How to run

```bash
# 1. Populate sha256 in fixtures.json (one-time per pinned tarball).
#    Cross-reference nodejs.org's SHASUMS256.txt and paste into the
#    sha256 field. Bench refuses to run with the placeholder.
curl -s https://nodejs.org/dist/v24.0.0/SHASUMS256.txt \
  | awk '/linux-arm64.tar.xz$/ {print $1}'

# 2. Run the bench. Downloads + caches the tarball on first run.
pnpm tsx scripts/bench/mount.ts

# Skip extra decomposed phases if you only need the historical tar result.
pnpm tsx scripts/bench/mount.ts --no-decompose

# Enable opt-in virtio-fs/FUSE profile capture in the result JSON.
pnpm tsx scripts/bench/mount.ts --profile

# Compare metadata cache policies. Default is cached.
pnpm tsx scripts/bench/mount.ts --cache-mode fast

# 3. Inspect the result.
cat scripts/bench/mount/results/<runId>.json
```

The bench drives the docker baseline by shelling out to
`docker-baseline.sh`, so a docker daemon needs to be reachable. Skip
the docker side with `--no-docker` to get just the mount-side number.

## Reading the result

```
{
  "runId": "2026-05-14T…",
  "host": { ... },
  "fixtures": { "tarball": "node-24-linux-arm64", "tarballBytes": N },
  "cacheMode": "cached",
  "workload": "tar -xzf …",
  "wallMs": N,
  "phases": {
    "vmBootMs": N,
    "tarExtractMs": N,
    "hostNativeExtractMs": N,
    "guestInputCopyMs": N,
    "guestRootfsExtractMs": N,
    "liveReadOnlyExtractMs": N,
    "liveWriteOnlyExtractMs": N,
    "liveReadWriteExtractMs": N,
    "smallFileMetadataMs": N,
    "hostBatchApplyMs": N,
    "hostBatchApplyBytes": N,
    "batchTotalMs": N,
    "largeSequentialWriteMs": N,
    "largeSequentialWriteMiBPerSec": N
  },
  "profiles": {
    "out": {
      "transport": {
        "requestCount": N,
        "virtqueueGatherNs": N,
        "fuseDispatchNs": N,
        "virtqueueScatterNs": N
      },
      "ops": {
        "LOOKUP": { "count": N, "sumNs": N }
      }
    },
    "in": { "transport": { }, "ops": { } }
  },
  "docker": { "wallMs": N }
}
```

`ratio = wallMs / docker.wallMs`. `tarExtractMs` remains the historical
current live-read + live-write tar extract metric; the other phase keys
are decomposition aids.

## Historical results

These rows predate #338 and are kept as a record. They were produced by
older versions of this bench that still measured the FUSE-over-vsock
transport and its per-op handler histogram.

### #329 — JS mount-server vs Zig port (darwin/arm64)

| metric                 | JS (Before) | Zig (After) | speedup |
| ---------------------- | ----------- | ----------- | ------- |
| wall-clock tar-extract | 70.36s      | 4.41s       | 15.95×  |
| docker baseline same   | 2.29s       | 2.21s       | —       |
| ratio impl / docker    | 30.66×      | 1.99×       | —       |
| handler-time fraction  | 88.2%       | 14.3%       | —       |
| WRITE count            | 39,873      | 5,529       | —       |

The Zig port dropped handler-fraction from 88.2% to ~14%, and
`FUSE_CAP_WRITEBACK_CACHE` coalesced tar's ~39k tiny `write(2)` calls
into ~5k max-write-sized FUSE WRITEs.

### #332 — virtio-fs vs FUSE-over-vsock (darwin/arm64, node-24 tarball)

| metric                 | fuse (vsock) | virtiofs (in-VMM) | speedup |
| ---------------------- | ------------ | ----------------- | ------- |
| wall-clock tar-extract | 4.52s        | 2.52s             | 1.80×   |
| docker baseline same   | 2.07s        | 1.97s             | —       |
| ratio transport/docker | 2.19×        | 1.28×             | —       |

Replacing the wire (per-request vsock RTT, the guest `/fuse-agent`
byte-pump, single-stream framing) with a virtqueue was the whole win;
the FUSE opcode handlers are byte-identical across both transports (the
shared `fuse.zig` module, #329 + #332). virtio-fs does not land
at-or-below docker on darwin/HVF — that bar is scoped to Linux/KVM+DAX.
With #338, virtio-fs is the only transport. See
`docs/adr/0003-remove-fuse-over-vsock-transport.md`.
