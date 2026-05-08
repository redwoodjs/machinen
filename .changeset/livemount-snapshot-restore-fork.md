---
"@machinen/runtime": minor
"@machinen/cli": minor
"@machinen/microvm": minor
---

`liveMount` now composes with `vm.snapshot()`, `vm.snapshot({ leaveRunning: true })`, `vm.fork()`, and `restore()` (#273). The runtime drives an unmount/remount choreography around CRIU: the guest's `/sbin/machinen-dump-preflight` umounts each FUSE share before the dump (refusing loudly if a workload fd is still open), the host tears down the per-mount `serveLiveMount` instances, CRIU dumps a clean tree, and on `leaveRunning`/`fork` the host respawns fresh servers and `/sbin/machinen-remount` re-forks the guest's `fuse-agent` against them. The bundle's `meta.json` gains a `liveMounts` block recording each `{guest, host, mode}` triple — bytes are NOT in the bundle (host paths are referenced, not copied). `restore()` re-establishes the recorded mounts by default; pass `restore({ liveMounts: [{guest, host, mode}] })` (CLI: `machinen restore --mount-live <host>:<guest>[:<mode>]`) to remap host paths on a different machine. Each override entry's `guest` must match a recorded one — `BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN` is thrown otherwise. The accepted cost is a brief unmount window during the dump (typically seconds, scales with memory size); workloads that quiesce before snapshot are unaffected. The legacy `SNAPSHOT_LIVE_MOUNT_ACTIVE` error code is removed.
