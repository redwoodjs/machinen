# Native real utility continuation attempt

Issue #497 connects the real-utility safety gates into one ordered continuation
attempt. It still refuses before jumping when the remaining target-native state
is not modeled.

## Gate order

The planner checks boundaries in this order:

1. thread state (`active-syscall`, signal/TLS/rseq refusals);
2. resource policy (including inherited stdio from #496);
3. mapping materialization;
4. target code-location mapping from #494;
5. source unwind discovery from #495;
6. target unwind/layout match;
7. target frame-state materialization for actual utilities;
8. synthetic target-caller frame installation for actual utilities;
9. target-native resume execution for actual utilities.

Only when every gate is modeled can a later implementation perform a final jump.
The planner itself never jumps. It reports:

```json
{
  "attemptedResume": false,
  "sourceTextReusedAsTargetCode": false,
  "sourceIsaEmulationUsed": false,
  "sidecarRuntimeUsed": false
}
```

## Target unwind matching

Issue #502 adds a separate target unwind matching proof. See
[Native real utility target unwind matching](./native-real-utility-target-unwind.md).

The original connected attempt still documents the fail-closed behavior when no
target match is supplied: it refuses at `target-unwind-mismatch` instead of
jumping. Actual utility planning can also refuse later at `target-frame-state`
when target unwind is found but unmodeled callee-saved slots remain, or at
`target-caller-frame` when synthetic caller-owned values exist but no target
caller frame has been installed, or at `target-resume-execution` when no actual
native execution path has been planned. When that execution path is planned, the
actual planner can reach `ready`. The actual two-host proof may then run a
bounded native trampoline and report a separate `targetResumeExecutionAttempt`,
without treating a fault as completed process migration.

## Proof

`pnpm native-real-utility-continuation --json` composes the modeled gates and
emits:

```text
real-utility-native-continuation-refused-at-target-unwind-mismatch
```

This is not counted as native migration success. It is a safety proof that the
first real-utility continuation attempt stops at the first remaining exact
boundary instead of using source-ISA emulation, a Node/Bun sidecar, app hooks, or
source text as target code.
