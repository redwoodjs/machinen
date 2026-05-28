# Goal 004: CRIU inside the guest substrate proof

Parent: [`FINAL-GOAL.md`](./FINAL-GOAL.md)

## Motivation

Machinen should prove that its guest Linux environment exposes enough checkpoint
and restore substrate for ordinary in-guest CRIU workflows. This does not claim
cross-ISA process-state translation. It proves that the guest/kernel surface is
credible.

## Objective

Run CRIU inside a Machinen guest and prove same-guest/same-ISA checkpoint/restore
for ordinary workloads.

Minimum profiles:

- simple C process;
- small Java/JVM process or service, with a clear refusal if unsupported.

## Required CRIU substrate proof

- [x] Run `/usr/sbin/criu check` or an equivalent scoped capability probe inside
      the guest.
- [x] Record CRIU version.
- [x] Record kernel feature probe output.
- [x] Compile and run a simple C process inside the guest.
- [x] Checkpoint and restore the C process with in-guest CRIU.
- [x] Verify observable continuation after restore.
- [x] Run a small Java/JVM process inside the guest.
- [x] Checkpoint/restore the JVM process, or refuse with a clear unsupported-state
      reason.
- [x] Record restore logs and verifier output.

## C profile requirements

- [x] Process emits pre-checkpoint progress.
- [x] CRIU checkpoint captures it.
- [x] CRIU restore resumes it.
- [x] Verifier proves post-restore progress is from the restored process.

## JVM profile requirements

One of:

- [x] JVM process checkpoint/restores and verifier passes; or
- [x] JVM process refuses with stable wording for unsupported runtime/JIT/thread
      state.

## Machine-readable output

Each row must include:

- `kind: machinen.cross-arch-criu.guest-criu-substrate`
- `guestArch`
- `kernelVersion`
- `criuVersion`
- `profile: c-simple | jvm-simple`
- `checkpointLog`
- `restoreLog`
- `verifierOutput`
- `state: completed | refused | skipped`
- refusal code/remediation when refused

## Non-goals

- Do not claim that a source-ISA CRIU image restores on a different ISA.
- Do not count source-ISA emulation as target-native process continuation.
- Do not silently accept JVM-private/JIT/thread state if CRIU cannot support it.

## Tests and smokes

- [x] In-guest CRIU check smoke.
- [x] C checkpoint/restore smoke.
- [x] JVM checkpoint/restore-or-refusal smoke.
- [x] Unit tests for checked summary classification.

## Documentation

- [x] Explain same-guest/same-ISA scope.
- [x] Explain why guest CRIU substrate is useful for the larger cross-arch goal.
- [x] Document CRIU/JVM refusal boundaries.

## Validation

Run and record timing for:

- [x] guest CRIU substrate smoke;
- [x] C CRIU smoke;
- [x] JVM CRIU smoke/refusal;
- [x] relevant unit tests;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
