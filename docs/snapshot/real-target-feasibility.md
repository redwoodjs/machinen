# Real target feasibility proof

Issue #422 tests a realistic target after the controlled C and tiny runtime probes.

The chosen target is the Machinen Node CLI itself. It is not a toy workload: it has a real module graph, package identity, command surface, VM operations, stdio, sockets/ports, PTYs, timers, and async runtime state.

## What restores now

The proof captures semantic metadata for the CLI:

- package name, version, and executable entry
- source and package SHA-256 build identity
- command surface from the CLI source
- ESM import graph summary
- argv/env/cwd resource metadata
- explicit native-handle refusal rules

The portable bundle writes this metadata to `real-target.json` and keeps `memory.bin` empty. Restore on another architecture validates the target source/package identity and restores the semantic metadata.

## What still refuses

Full live Node process restore is not claimed yet. The proof returns this actionable refusal:

```json
{
  "code": "runtime-heap-unsupported",
  "message": "live Node process restore needs a runtime adapter that can enumerate JS roots, object identity, async queues, and native handles"
}
```

A full adapter for a Claude-Code or pi-style target needs:

1. Node/V8 runtime version and heap/serializer compatibility metadata.
2. Module graph and source/build identity sidecar data.
3. Semantic JS roots with reference ids, not raw heap bytes.
4. Native handle recipes/refusals for stdio, sockets, timers, child processes, and PTYs.

## Mismatch refusal

Restore refuses stale metadata before using it. If the source/package identity does not match the bundle, restore returns `target-build-mismatch`.

## Verify

Run:

```sh
pnpm real-target-feasibility
```

Cross-ISA proof can be done by generating the bundle on arm64 and validating it on amd64:

```sh
node scripts/real-target-feasibility.mjs restore --bundle <bundle>
```
