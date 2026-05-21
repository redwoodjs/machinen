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
6. target unwind/layout match.

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
jumping.

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
