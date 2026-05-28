# Final goal: Architecture-portable snapshot proof

## North star

Machinen should provide architecture-portable snapshots for real workloads: a
user can move a running or stateful workload between `amd64` and `arm64`, get
target-native execution on the destination, and see every user-visible
discontinuity either preserved, recreated with defined semantics, or refused
with clear remediation.

This does **not** mean blindly replaying source-ISA VM memory or raw source
checkpoint images on a different ISA. A restore only counts when Machinen uses an
explicit portable state model, target-native reconstruction, and a target-native
verifier. Source ISA emulation, sidecar success, metadata-only continuation, or
raw cross-ISA source checkpoint image replay must not be counted as success
unless that mode is explicitly labeled as a demo/emulation mode.

## Headline proof gauntlet

These are the things we have to prove before the architecture-portable snapshot
claim feels credible.

### 1. Opposite-ISA VM execution

Prove that Machinen can run a VM whose guest ISA differs from the host ISA.

- `amd64` guest on an `arm64` host.
- `arm64` guest on an `amd64` host where available.
- Record host architecture, guest architecture, provider/accelerator mode,
  kernel version, rootfs digest, and whether execution used hardware assist or
  emulation.
- Verify inside the guest with `uname -m`, ELF architecture checks, and a small
  compiled program so the proof cannot be confused with host sidecar success.

If you can run an x86 VM on ARM, or ARM on x86, that is already a major proof.

### 2. Stateful databases

Prove that real stateful services survive the supported portable snapshot path.

- PostgreSQL clean/quiesced logical portable restore in both `amd64 -> arm64` and
  `arm64 -> amd64` directions.
- PostgreSQL unsafe-neighbor refusals for active transactions, active sessions,
  dirty WAL, host-mounted data directories, physical byte-copy, and verifier
  mismatch.
- SQLite rollback-journal and WAL-checkpoint restore with target-native
  verification.
- SQLite refusal for dirty or in-flight states.
- Record database version, schema/data digest, dump/checkpoint digest, source
  arch, target arch, and verifier output in checked summaries.

If SQLite or PostgreSQL can move across architectures without crashing or lying,
that is the practical credibility bar.

### 3. Guest checkpoint substrate

Prove that a Machinen guest exposes enough Linux checkpoint/restore substrate for
guest checkpoint tooling to work on ordinary guest workloads.

- Run a scoped checkpoint capability probe inside the guest. The current fixture
  uses `/usr/sbin/criu check` as one Linux tool-level probe.
- Compile and run a simple C process in the guest.
- Use checkpoint tooling in the guest to checkpoint and restore that C process.
- Verify observable continuation after restore.
- Run a small Java/JVM process in the guest.
- Use checkpoint tooling in the guest to checkpoint and restore that JVM process,
  or fail closed with a clear unsupported-state reason if the JVM profile is
  outside the supported boundary.
- Record checkpoint tool version, kernel feature probes, process command,
  verifier output, and restore logs.

This is a same-guest/same-ISA checkpoint proof unless a future goal explicitly
models cross-ISA process-state translation.

### 4. Portable snapshot plus guest checkpoint composition

Prove the two layers do not break each other.

- Run a guest checkpoint/restore proof before a Machinen snapshot.
- Snapshot and restore the Machinen VM through the supported path.
- Run the guest checkpoint/restore proof again after Machinen restore.
- Verify a guest-created checkpoint image remains readable after Machinen restore
  when it lives on supported guest storage.
- Do not claim that a source-ISA checkpoint image can restore on a different ISA.

### 5. C and Java runtime confidence

Prove more than toy shell commands.

- C static binary profile.
- C dynamic binary profile.
- C profiles for file IO, timers, signals, and a TCP listener.
- Java/JVM loop or small service profile with JVM version and provenance.
- Classify every profile as product-supported, proof-only, stretch, or refused.
- Refuse unsupported active sockets, native library ambiguity, unmodeled
  signal/timer state, JVM-private state, or process topology instead of silently
  dropping it.

C exposes native ABI/kernel boundaries. Java exposes a heavy runtime with
threads, JIT/class metadata, and many file mappings. Passing or honestly refusing
these profiles says a lot about whether the system is real.

### 6. Advanced Linux facility probes

If we want to really stress the model, prove or clearly refuse advanced kernel
features.

- seccomp: run a process with an allow/deny filter and prove the expected syscall
  is blocked before and after the supported boundary, or refuse with a stable
  code.
- eBPF: load a minimal permitted BPF program/profile where host and guest policy
  allow it, verify behavior, and record required capabilities; refuse unavailable
  or unsafe BPF state clearly.
- Namespaces, cgroups, and capabilities: record whether each is preserved,
  recreated, proven irrelevant, or refused.

These are not required for first product support, but they are high-signal probes
for whether the guest/kernel surface is robust.

### 7. Nested virtualization stretch proof

Nested virtualization is a spectacle proof, not a prerequisite for the portable
snapshot product claim.

- Keep nested virtualization out of required product support unless the host and
  provider make it reliable.
- Where available, run the existing nested-virtualization/Firecracker guide as a
  stretch smoke.
- Explicitly state that provider-level snapshots/forks are blocked while a VM has
  nested virtualization enabled unless a future goal implements a safe model.
- Treat stacks such as an `arm64` L2 VM inside an `amd64` L1 VM on an `arm64` L0
  host as demo/stretch artifacts with clear acceleration vs emulation labeling.

## Required output

The final proof suite should produce a machine-readable checked summary with one
row per claim. Each row must state:

- product support, proof-only feasibility, stretch demo, or refusal;
- source architecture and target architecture;
- host architecture and provider mode;
- whether target execution was native, accelerated, or emulated;
- captured state model;
- verifier command and output;
- artifact digests and provenance;
- `migrationCompleted=true` only for real supported restores;
- `migrationCompleted=false` plus a stable refusal code for unsupported states.

## Completion criteria

This final goal is complete when Machinen has a repeatable proof gauntlet showing
all of the following:

- opposite-ISA VM execution works on the supported host matrix;
- PostgreSQL and SQLite stateful workloads cross architectures through explicit
  portable state and target-native verification;
- Guest checkpointing works inside the VM for at least a simple C process and either works or
  fails closed for a JVM process;
- guest checkpoint still works across a Machinen snapshot/restore cycle;
- C and Java profiles are classified honestly;
- seccomp and eBPF are either proven or refused with stable wording;
- nested virtualization is demonstrated only as a clearly labeled stretch proof;
- no unsupported source-ISA emulation, raw checkpoint replay, sidecar success, or
  metadata-only continuation is reported as portable restore success.
