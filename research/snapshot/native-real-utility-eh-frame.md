# Native real utility `.eh_frame` frame discovery

Issue #495 moves unwind discovery toward real system binaries. Real utilities are
often stripped, so debug-only `.debug_frame` data may be missing. Runtime unwind
metadata in `.eh_frame` is still commonly present because native exception and
stack-walking tools need it.

## Rule

The parser consumes `readelf --debug-dump=frames` output from a real binary or a
stripped fixture and extracts the FDE covering the captured source PC.

The first modeled arm64 rules are intentionally narrow:

- CFA is based on `x29` or `sp` with a constant offset.
- saved return address `x30` is at a CFA-relative stack slot.
- captured stack bytes must include that return-address slot.

For loaded shared objects, callers can provide a load bias so module-relative FDE
PC ranges are relocated to captured process addresses.

When those rules are present, `discoverNativeUnwindFrames()` produces a
`NativeStackFrame` with the source SP, CFA, return address, and return-address
slot. The proof stops there; it does not claim arbitrary stack resume.

## Precise refusals

- `unwind-metadata-missing` — no `.eh_frame` text was available.
- `unwind-fde-missing` — no FDE covers the captured PC.
- `unwind-rule-unsupported` — the FDE uses CFI rules not modeled yet.
- `return-slot-unreadable` — the computed saved return-address slot was not in
  captured stack memory.
- `target-unwind-mismatch` — reserved for target/source unwind layout mismatch
  once real target-frame matching is connected.

These are distinct from generic pointer ambiguity. A missing return slot is an
unwind boundary, not permission to guess.

## Proof

`pnpm native-real-utility-eh-frame --json` builds a native arm64 fixture, strips
debug info while retaining `.eh_frame`, captures it with ptrace/procfs, parses
the FDE that covers the active PC, reads the saved return address from captured
stack memory, and emits:

```text
captured-arm64-source-frame-discovered-from-real-eh-frame
```

This proves frame discovery can come from runtime unwind metadata rather than
source-side debug hooks or proof-known frame slots.
