# Production Node restore workflow

> **Status: archived.** The old production-shaped Node runtime-profile route is no longer active smoke or product evidence. Use `pnpm run archive-node-production-restore` only with this status in mind.

Goal 34 validates a production-shaped Node portable restore workflow. The proof
app is intentionally small but includes the app features we need to guard:
package metadata, a local dependency, config, HTTP routes, file writes, a JSONL
SQLite-like durable store, and a real compiled `.node` N-API addon.

## Run the production-shaped proof

```bash
pnpm run archive-node-production-restore -- --keep --work-dir /tmp/machinen-node-production
```

The command captures/restores these routes:

- local arm64 current Node -> Proxmox amd64 matching Node major;
- remote-builder arm64 Node 20 -> Proxmox amd64 Node 20;
- remote-builder arm64 Node 22 -> Proxmox amd64 Node 22;
- remote-builder arm64 Node 24 -> Proxmox amd64 Node 24.

Each target route verifies:

- HTTP health route;
- file write route;
- durable JSONL database/log state;
- real compiled `.node` addon behavior;
- package/dependency/config/addon/state artifact hashes;
- no source-ISA emulation, sidecar runtime, source text replay, or app hooks.

## Repeatability

```bash
pnpm run archive-node-production-repeatability -- --keep --work-dir /tmp/machinen-node-production-repeat
```

The repeatability wrapper runs the production restore proof repeatedly with a
100% pass-rate requirement and stores per-iteration summaries and logs.

## Unsupported states

The proof records stable refusal codes for unsafe neighboring states including
active unverified HTTP/TCP connections, stale package graphs, native addon ABI
mismatch, source text replay, sidecar runtime, source ISA emulation, loader hooks,
child processes, inspector sessions, and ambiguous dirty state.

## User-facing workflow boundary

A production user workflow must provide an app path, start command, verifier, and
source/target host configuration. Goal 34's smoke command is the validated
reference workflow until a higher-level CLI wraps those inputs directly.
