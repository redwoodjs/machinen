# Native real utility target unwind matching

Issue #502 proves the next gate after source `.eh_frame` discovery: the source
frame must match a target-native amd64 unwind frame before a real utility resume
can be considered safe.

## Rule

The matcher consumes the target module's `.eh_frame` metadata for the mapped
target RVA. Shared-object FDE ranges are matched with the target module load bias,
and real amd64 CIE return-address slots are inherited by their FDEs. The first
modeled target frame shape is narrow:

- CFA is based on `rsp` or `rbp` with a constant offset.
- the target return address is a CFA-relative stack slot, normally `cfa-8`.
- only the frame pointer (`rbp`) may be described as saved callee state.
- any other callee-saved register state refuses until modeled.

The strict behavior remains the default. Actual-utility planning may explicitly
record those callee-saved slots and move the refusal to a later target
frame-state gate so the proof can distinguish "no target FDE" from "target frame
state is not materialized yet".

A source frame being discovered is not enough. The target landing must expose a
compatible return contract so later stack materialization knows where target
native code will return.

## Precise refusals

- `target-unwind-mismatch` — no target FDE covers the mapped target address.
- `target-frame-layout-unsupported` — target CFA/frame shape is not modeled.
- `target-return-slot-unsupported` — the target return-address slot is not a
  modeled CFA-relative stack slot.
- `target-callee-saved-state-unsupported` — target code saves non-modeled
  callee-saved registers.

Existing earlier gates still run first: active syscall, resources, mapping,
target code-location, and source unwind discovery.

## Proof

`pnpm native-real-utility-target-unwind --json` parses amd64 `.eh_frame` text for
a real-utility-shaped target function, matches it with a source `.eh_frame`
frame, and feeds the match into the continuation planner. The planner reaches
`ready` but still does not jump.

The proof emits:

```text
real-utility-target-unwind-matched-by-amd64-eh-frame
```
