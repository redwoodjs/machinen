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

## Current boundary

The first connected attempt reaches target-native code-location mapping,
inherited stdio policy, and source `.eh_frame` frame discovery. It then refuses
at:

```text
target-unwind-mismatch
```

That is intentional. We have not yet proven that the source unwind-derived frame
matches a target-native amd64 unwind landing for a real utility module.

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
