# Benchmark results matrix

Committed benchmark artifacts for PR #960. Times are median / p95 unless noted. Dirty rootdisk environment runs were captured before committing the benchmark-runner changes and are kept as comparative evidence, not clean release baselines.

## Run matrix

| Host         | Guest | Accelerator | Variant          | Commit     | Dirty | Filesystems       | Artifact                                             |
| ------------ | ----- | ----------- | ---------------- | ---------- | ----- | ----------------- | ---------------------------------------------------- |
| linux/x64    | amd64 | KVM         | baseline disk    | `3d740fd0` | no    | not recorded      | `baseline-kvm-amd64-clean-2026-06-16T18-25-39Z.json` |
| linux/x64    | amd64 | KVM         | rootdisk disk    | `8ca1327c` | yes   | ext4              | `rootdisk-env-disk-all-2026-06-16T20-34-46Z.json`    |
| linux/x64    | amd64 | KVM         | rootdisk ramdisk | `8ca1327c` | yes   | tmpfs             | `rootdisk-env-ramdisk-all-2026-06-16T20-45-36Z.json` |
| darwin/arm64 | arm64 | HVF         | baseline disk    | `af77729c` | no    | probe unavailable | `baseline-hvf-arm64-clean-2026-06-16T21-22-46Z.json` |

## Lifecycle latency

| Host/guest           | Variant          |        Cold boot |      Warm boot |  Snapshot wall |    Restore cold |   Restore warm | Boot rootdisk copy | Restore rootdisk copy |
| -------------------- | ---------------- | ---------------: | -------------: | -------------: | --------------: | -------------: | -----------------: | --------------------: |
| linux/x64 → amd64    | baseline disk    |   8.35s / 26.26s | 9.14s / 20.92s |  4.62s / 8.22s | 10.16s / 18.29s |  2.76s / 9.04s |     1.20s / 19.94s |                     — |
| linux/x64 → amd64    | rootdisk disk    | 15.16s / 106.20s | 1.21s / 22.32s | 6.12s / 15.39s |  6.30s / 12.19s | 3.01s / 14.64s |     7.36s / 92.95s |        4.54s / 10.17s |
| linux/x64 → amd64    | rootdisk ramdisk |    6.62s / 6.85s |  438ms / 487ms |  3.86s / 5.31s |   1.95s / 2.10s |  1.98s / 1.98s |      468ms / 511ms |         466ms / 526ms |
| darwin/arm64 → arm64 | baseline disk    |    1.03s / 1.47s |    74ms / 76ms |  1.64s / 1.77s |   1.07s / 1.08s |  1.08s / 1.08s |          4ms / 6ms |             2ms / 2ms |

## Rootdisk materialization detail

| Host/guest           | Variant          | Cold rootdisk phase | Cold gunzip prebake | Cold copy mode | Copy primitive | Fallback reason |
| -------------------- | ---------------- | ------------------: | ------------------: | -------------- | -------------- | --------------- |
| linux/x64 → amd64    | baseline disk    |      8.30s / 26.21s |       6.27s / 7.17s | —              | —              | —               |
| linux/x64 → amd64    | rootdisk disk    |    15.12s / 106.15s |       6.22s / 7.69s | copy×5         | node-copy×5    | ENOTSUP×5       |
| linux/x64 → amd64    | rootdisk ramdisk |       6.58s / 6.81s |       6.09s / 6.27s | copy×5         | node-copy×5    | ENOTSUP×5       |
| darwin/arm64 → arm64 | baseline disk    |       991ms / 1.08s |       851ms / 973ms | cow×5          | darwin-cp-c×5  | none×5          |

## Workload throughput / external suites

| Host/guest           | Variant          | Guest CPU SHA256 MiB/s | Host CPU SHA256 MiB/s |  Mount extract | Docker extract | Net latency µs/ping | Net RX MB/s | Net TX MB/s |
| -------------------- | ---------------- | ---------------------: | --------------------: | -------------: | -------------: | ------------------: | ----------: | ----------: |
| linux/x64 → amd64    | baseline disk    |                    255 |                  2640 |  9.07s / 9.07s |              — |                  93 |         265 |         281 |
| linux/x64 → amd64    | rootdisk disk    |                    292 |                  2627 | 9.82s / 10.07s |              — |                  79 |         274 |         305 |
| linux/x64 → amd64    | rootdisk ramdisk |                    255 |                  2598 |  9.07s / 9.07s |              — |                  87 |         280 |         292 |
| darwin/arm64 → arm64 | baseline disk    |                    451 |                  3250 |  3.87s / 3.91s |  1.76s / 1.94s |                  92 |         345 |         257 |

## Readout

- macOS arm64/HVF shows true CoW rootdisk copies (`darwin-cp-c`) and sub-10ms rootdisk copy medians.
- Linux amd64/KVM disk runs on ext4 fall back to real copies (`node-copy`, `ENOTSUP`), making lifecycle latency storage dominated.
- Linux amd64/KVM ramdisk removes most block-device copy cost but still cannot prove CoW reflink behavior; cold boot remains dominated by gunzipping the prebaked rootdisk image.
- The next missing variant is Linux amd64/KVM with scratch/cache on a reflink-capable filesystem such as btrfs, XFS reflink, or ZFS clone-backed storage.
