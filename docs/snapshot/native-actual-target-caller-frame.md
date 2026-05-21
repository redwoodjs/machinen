# Native actual synthetic target caller frame

Issue #530 plans the synthetic target caller frame for the actual `/bin/sleep` proof.

## What is new

After target libc unwind matching, the proof can fill caller-owned amd64 callee-saved slots with explicit synthetic target-caller values. This issue groups those values into a synthetic caller-frame plan with a sentinel stack pointer and return address.

The synthetic values are marked as `synthetic-target-caller`. They are not copied from arm64 registers, and they are not treated as source text or source-ISA execution.

## Boundary

Planning the caller frame is not the same thing as resuming the process. The proof still emits `attemptedResume: false`, `sourceIsaEmulationUsed: false`, and `sidecarRuntimeUsed: false`.

With the caller-frame plan present, the continuation planner can reach its `ready` state. That means the current modeled gates have data. It does not mean a native jump has executed yet.
