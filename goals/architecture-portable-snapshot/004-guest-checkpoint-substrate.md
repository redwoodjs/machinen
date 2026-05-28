# Goal 004: Guest checkpoint substrate proof

Parent: [`FINAL-GOAL.md`](./FINAL-GOAL.md)

## Motivation

Machinen should prove that its guest Linux environment exposes enough checkpoint
and restore substrate for ordinary in-guest checkpoint workflows. This does not
claim cross-ISA process-state translation. It proves that the guest/kernel
surface is credible.

## Objective

Run a scoped checkpoint tool inside a Machinen guest and prove same-guest,
same-ISA checkpoint/restore for ordinary workloads. The current fixture uses the
Linux `criu` command as that tool; the product claim is architecture-portable
snapshotting, not compatibility with any one checkpoint file format.

Minimum profiles:

- simple C process;
- small Java/JVM process or service, with a clear refusal if unsupported.

## Required checkpoint substrate proof

- [x] Run `/usr/sbin/criu check` or an equivalent scoped capability probe inside
      the guest.
- [x] Record checkpoint tool version.
- [x] Record kernel feature probe output.
- [x] Compile and run a simple C process inside the guest.
- [x] Checkpoint and restore the C process with the in-guest checkpoint tool.
- [x] Verify observable continuation after restore.
- [x] Run a small Java/JVM process inside the guest.
- [x] Checkpoint/restore the JVM process, or refuse with a clear unsupported-state
      reason.
- [x] Record restore logs and verifier output.

## C profile requirements

- [x] Process emits pre-checkpoint progress.
- [x] The checkpoint tool captures it.
- [x] The checkpoint restore resumes it.
- [x] Verifier proves post-restore progress is from the restored process.

## JVM profile requirements

One of:

- [x] JVM process checkpoint/restores and verifier passes; or
- [x] JVM process refuses with stable wording for unsupported runtime/JIT/thread
      state.

## Machine-readable output

Each row must include:

- `kind: machinen.architecture-portable-snapshot.guest-checkpoint-substrate`
- `guestArch`
- `kernelVersion`
- `checkpointToolVersion`
- `profile: c-simple | jvm-simple`
- `checkpointLog`
- `restoreLog`
- `verifierOutput`
- `state: completed | refused | skipped`
- refusal code/remediation when refused

## Non-goals

- Do not claim that a source-ISA checkpoint image restores on a different ISA.
- Do not count source-ISA emulation as target-native process continuation.
- Do not silently accept JVM-private/JIT/thread state if the checkpoint tool
  cannot support it.

## Tests and smokes

- [x] In-guest checkpoint check smoke.
- [x] C checkpoint/restore smoke.
- [x] JVM checkpoint/restore-or-refusal smoke.
- [x] Unit tests for checked summary classification.

## Documentation

- [x] Explain same-guest/same-ISA scope.
- [x] Explain why guest checkpoint substrate is useful for the larger cross-arch goal.
- [x] Document checkpoint/JVM refusal boundaries.

## Validation

Run and record timing for:

- [x] guest checkpoint substrate smoke;
- [x] C checkpoint smoke;
- [x] JVM checkpoint smoke/refusal;
- [x] relevant unit tests;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
