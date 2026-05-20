# Bun runtime adapter investigation

Issue #437 records the Bun side of the runtime-adapter plan.

The current helper probes Bun availability and packaged executable identity. If Bun is missing, the result is a stable `runtime-adapter-missing` refusal. If a packaged executable path is provided, Machinen records its SHA-256 or refuses with `target-build-mismatch` when the file cannot be checked.

Even when Bun is installed, full heap/process restore is still refused with `runtime-heap-unsupported` until a Bun in-process adapter or sidecar can expose semantic roots, object identity, async state, and native handles.

## What this proves

- Bun absence is a clear refusal, not a test failure.
- Packaged Bun targets need explicit executable identity metadata.
- Raw Bun heap bytes are not a portable restore contract.

The next step is to pair this probe with the Node-style semantic graph adapter once Bun exposes or embeds the necessary adapter hooks.
