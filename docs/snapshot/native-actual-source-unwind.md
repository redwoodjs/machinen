# Native actual source unwind discovery

Issue #520 discovers source unwind metadata for actual real-utility libc frames.

## What is new

The actual arm64 `/bin/sleep` proof can now parse source `.eh_frame` metadata for
the active libc frame and write a `native-source-unwind.json` proof sidecar into
the source bundle. A later amd64 target-planning run consumes that sidecar and
passes the source-unwind gate.

## Shared-object support

Real libc `.eh_frame` FDE program counters are module-relative. The parser now
accepts a source module load bias, matches the module-relative PC, and emits a
loaded rule whose range covers the captured absolute source PC.

The arm64 libc frame shape observed for `clock_nanosleep` uses:

- CFA based on `sp` plus an offset;
- saved `x30` at a CFA-relative slot.

That shape is modeled explicitly. Unsupported unwind rules still fail closed with
`unwind-rule-unsupported`.

## Boundary

The sidecar contains unwind rules and discovered source frames, not source text.
It does not resume the process, emulate arm64, or claim that target unwind state
matches yet. Missing metadata, missing stack bytes, or unreadable return slots
remain precise refusals.
