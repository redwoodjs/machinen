# Native actual target frame-state gate

Issue #524 separates finding target unwind metadata from proving the target frame state is safe.

## What changed

Actual `/bin/sleep` target planning can now record amd64 callee-saved stack slots from the matched target libc FDE. That means the target unwind rule can be found and matched for its return-address contract without pretending the saved registers are already safe.

The existing strict matcher remains the default for older proofs. The actual utility path opts into recording callee-saved slots and then lets the continuation planner apply a later safety gate.

## Fail-closed boundary

If the matched target frame needs non-modeled callee-saved state, the planner refuses at `target-frame-state` with `target-callee-saved-state-unsupported`.

This is more precise than treating the FDE as missing. It says: target unwind was found, but the target stack/register state needed by that native frame has not been materialized yet.

## Non-claims

This does not synthesize target register values, does not build a real target stack frame, and does not resume `/bin/sleep`. It only moves the proof to the next honest blocker.
