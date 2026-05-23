# Native machine restore plan

Issue #649 adds the top-level fail-closed planner for target-native machine
restore.

`planNativeMachineRestore()` composes the separate proof gates instead of letting
them remain independent islands:

- thread restore boundary, including TLS, SIMD/FPU, signals, and modeled active
  syscall continuations;
- translated stack-window materialization;
- bounded return-chain planning;
- native mapping materialization.

The plan is `accepted` only when every included subplan succeeds. Any refusal
from a subplan is preserved with its precise code, and the refused result still
carries the subplans for diagnostics. Accepted plans retain the subplans needed by
later descriptor generation and target VM restore.

This is still a planning boundary. It does not by itself write target memory or
jump to restored code; later descriptor and loader work consumes this unified
plan.
