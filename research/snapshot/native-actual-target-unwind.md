# Native actual target unwind discovery

Issue #522 wires actual captured `/bin/sleep` target unwind discovery into the fail-closed continuation planner.

## What is new

The amd64 target-planning proof now reads `.eh_frame` metadata from the explicit target module inventory and tries to match the mapped target-native libc landing against the discovered arm64 source frame.

Target shared objects use module-relative FDE program counters, so the parser applies the target module load bias before matching the target address. It also inherits the CIE return-address rule used by real amd64 libc FDEs.

## Boundary

This is still a safety gate, not a resume claim. The matcher only accepts narrow target frame contracts:

- CFA based on `rsp` or `rbp` with a constant offset;
- return address stored in a CFA-relative target stack slot;
- no unmodeled callee-saved target register state.

If actual libc target unwind metadata is present but the frame saves registers that are not modeled yet, the actual path records those slots and lets the later target frame-state gate refuse instead of pretending the continuation is safe.

## Proof effect

With explicit sleep deferral, an arm64 source bundle, and an amd64 target root, the actual proof advances beyond generic `target-unwind-mismatch` and exposes the target frame-state blocker for the libc sleep frame.
