# Native return-chain planning

Issue #637 extends the single translated-frame proof into a bounded target-native
return-chain plan.

## Command

```sh
pnpm native-return-chain
```

## Contract

`planNativeReturnChain()` accepts target-native frame descriptors only. It does
not reuse source stack bytes as target continuation state. A chain is
materialized only when:

- the frame count is non-zero and below the caller-provided `maxFrames` bound;
- frame pointer, CFA, return-address slot, and caller-link addresses are valid
  and inside the target stack window;
- each return slot is exactly `framePointer + 8` for the current amd64 ABI
  proof shape;
- every frame has target unwind provenance (`target:*`);
- each non-terminal frame links to the next older frame, and the terminal frame
  does not name a caller.

## Refusals

- `target-frame-layout-unsupported` for malformed bounds, too-deep chains,
  addresses outside the target stack, missing/mismatched caller links, or
  non-target unwind provenance;
- `target-return-slot-unsupported` when a frame's return-address slot does not
  match the validated target frame shape.

This is a validation/materialization boundary. It prepares the restore path to
consume multi-frame chains while still failing closed for ambiguous layouts.
