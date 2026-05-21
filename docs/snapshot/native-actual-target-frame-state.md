# Native actual target frame-state gate

Issues #524, #526, and #528 separate finding target unwind metadata from proving the target frame state is safe.

## What changed

Actual `/bin/sleep` target planning can now record amd64 callee-saved stack slots from the matched target libc FDE. That means the target unwind rule can be found and matched for its return-address contract without pretending the saved registers are already safe.

The actual utility path also inventories the target-native value required for each slot. If no value is available, the frame-state planner refuses with a value-specific code instead of saying the whole frame shape is unknown.

When an explicit synthetic target-caller policy is provided, the planner can fill caller-owned callee-saved slots with ABI-neutral synthetic values. Those values are marked `synthetic-target-caller`; they are not source register translations.

The existing strict matcher remains the default for older proofs. The actual utility path opts into recording callee-saved slots and then lets the continuation planner apply a later safety gate.

## Fail-closed boundary

If the matched target frame needs a callee-saved value that has not been translated to target-native state, the planner refuses at `target-frame-state` with `target-frame-register-value-unavailable`.

This is more precise than treating the FDE as missing. It says: target unwind was found, the target stack slot is known, but the target register value needed for that native frame has not been materialized yet.

## Non-claims

This does not translate source registers into amd64 callee-saved registers, does not build a real target stack frame, and does not resume `/bin/sleep`. It only moves the proof to the next honest blocker: `target-caller-frame` / `target-caller-frame-unavailable`.
