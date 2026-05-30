# Guest checkpoint substrate proof

This proof checks the Linux checkpoint/restore surface inside one Machinen guest.
It is same-guest and same-ISA only. It does not claim that a checkpoint image
captured on one CPU architecture restores on another CPU architecture.

## Row shape

Rows use this machine-readable kind:

```json
{
  "kind": "machinen.architecture-portable-snapshot.guest-checkpoint-substrate",
  "guestArch": "aarch64",
  "kernelVersion": "6.12.20",
  "checkpointToolVersion": "Version: 4.2",
  "profile": "c-simple",
  "state": "completed"
}
```

Every row records `checkpointLog`, `restoreLog`, `verifierOutput`, and kernel
feature probe output. The current fixture uses `criu check` plus
`criu check --feature seccomp_suspend` as the Linux tool-level probe.
The scope block always says `crossIsaCheckpointReplay=false` and
`sourceIsaEmulationUsed=false`.

## C profile

The C profile boots a normal Machinen guest, uses the guest exec agent to install
Debian build tools, compiles a tiny C counter inside the guest, and runs it as a
plain same-ISA process. The counter writes lines like:

```text
pid=761 counter=11
pid=761 counter=12
pid=761 counter=13
```

The proof runs the guest checkpoint tool (`criu dump`, then `criu restore` in the
current fixture), and then checks that the restored process continues appending
counter lines. A real completed example from the live
smoke was:

```json
{
  "guestArch": "aarch64",
  "kernelVersion": "6.12.20",
  "checkpointToolVersion": "Version: 4.2",
  "preCheckpointProgress": 8,
  "postRestoreProgress": 15,
  "restoredPid": 761
}
```

The verifier is intentionally simple: post-restore progress must be greater than
pre-checkpoint progress, and the progress tail must still carry the restored PID.

The counter closes inherited non-stdio file descriptors at startup. That matters
because Machinen's normal workload path uses a small seccomp/no-io_uring shim and
exec/vsock helpers. Those inherited descriptors are useful for normal VM
operation, but the current checkpoint tool cannot dump them as part of this tiny
process profile.

## JVM profile

The base Machinen guest currently does not ship a JVM. The JVM row therefore
refuses with:

```json
{
  "profile": "jvm-simple",
  "state": "refused",
  "refusalCode": "jvm-runtime-unavailable"
}
```

If a future guest image includes Java, the profile still must not silently accept
JVM private state. It should either run a JVM-specific checkpoint/restore verifier
or refuse with `jvm-checkpoint-runtime-state-unsupported` until JIT, thread, and
runtime state are modeled.

## Why this helps the larger cross-arch goal

Guest checkpoint substrate is useful because it proves the guest kernel and tools
can do ordinary same-ISA checkpoint/restore work. Later roadmap steps can compose that
with Machinen snapshots. This is still not cross-ISA checkpoint replay.

## What this does not prove

This does not prove restoring checkpoint images across `amd64 <-> arm64`. It does
not preserve source-ISA registers on a different target ISA. It does not prove JVM
checkpoint/restore in the current base image. It does not prove arbitrary Linux
processes; it proves one small C counter and a stable JVM refusal boundary.

## Running

```sh
pnpm run proof-guest-checkpoint-substrate
pnpm run proof-guest-checkpoint-c
pnpm run proof-guest-checkpoint-jvm
```
