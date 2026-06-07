# Expanded Node cross-architecture restore claims

> **Status: archived.** The old expanded Node runtime-profile route is no longer active smoke or product evidence. Use `pnpm run archive-node-expanded-restore` only with this status in mind.

Goal 35 records the proof envelope for the Node.js claims that Goal 34 did not
make. The validated route is amd64 source capture to arm64 target-native restore
for Node 20, 22, and 24, with no source-ISA emulation, source text replay,
sidecar runtime, or app restore hooks.

## Validated command

```bash
pnpm run archive-node-expanded-restore -- --keep --work-dir /tmp/machinen-node-expanded
```

The smoke runs on:

- source: Proxmox amd64 (`root@192.168.0.8`) in Node 20/22/24 containers;
- target: remote-builder arm64 (`friend@100.126.46.90`) in matching Node
  20/22/24 containers.

## Claims now covered

- arbitrary existing Node processes discovered by PID/command/runtime state;
- active HTTP/TCP preservation for the narrow verified cleartext HTTP/1 streaming
  response subset, with unsafe packet/socket/TLS neighbors refused;
- child process + IPC trees for the supported fork/stdio/IPC subset;
- active inspector/debugging sessions are discovered and refused with stable
  protocol-state codes;
- dirty persistent state has an acknowledged-bytes/atomic-rename durability
  contract, with mmap/lock/fsync-gap/external-store ambiguity refused;
- broader native addon/ABI coverage for multiple target-native N-API artifacts,
  with architecture, ABI, dependency, CPU-feature, and opaque-state refusals;
- amd64 -> arm64 restore route with target-native arm64 execution.

## Matrix presets

The checked summaries live in
`research/snapshot/checked-summaries/node-expanded/`. Use:

```bash
node scripts/portable-machine-proof-matrix.mjs \
  --preset node-expanded \
  --check-summary-dir research/snapshot/checked-summaries/node-expanded \
  --json
```

Focused presets are also available:

- `node-expanded-arbitrary-existing`
- `node-expanded-active-http-tcp`
- `node-expanded-child-process-ipc`
- `node-expanded-inspector`
- `node-expanded-dirty-state`
- `node-expanded-native-addon-abi`
- `node-expanded-amd64-to-arm64`

## Boundaries

The support envelope remains proof-driven. States outside the checked summaries
must fail closed with stable refusal codes and `migrationCompleted=false` until a
future proof graduates them.
