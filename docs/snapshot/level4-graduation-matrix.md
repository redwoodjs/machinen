# Level 4/5 graduation matrix

Goal 002 tracks the best bang-for-buck path from semantic/runtime-aware portable
snapshot support toward real Level 4/5 support.

The checked summary is written to:

```txt
docs/snapshot/checked-summaries/level4-graduation/goal-002.json
```

Regenerate it with:

```sh
pnpm run level4-graduation-matrix
```

## Strategy

The graduation path is intentionally narrow and now has one execution goal per
phase:

1. [`goals/003.md`](../../goals/003.md) — Ping Level 2 -> narrow Level 4 socket reconstruction.
2. [`goals/004.md`](../../goals/004.md) and [`goals/005.md`](../../goals/005.md) — Pipes + eventfd Level 4 primitives.
3. [`goals/006.md`](../../goals/006.md) — timerfd Level 4 primitive.
4. [`goals/007.md`](../../goals/007.md) — TCP listener-only Level 4 reconstruction.
5. [`goals/008.md`](../../goals/008.md) — Node event-loop resources mapped onto Level 4 primitives.
6. [`goals/009.md`](../../goals/009.md) — selected Node Level 5 proof composition only; runtime-profile or selected-state harnesses must not be productized as snapshot/restore support.
7. [`goals/011.md`](../../goals/011.md) — Ping becomes the first Level 4 portable machine snapshot workload.

Do not start with active TCP continuation, arbitrary Node process productization,
JVM Level 5, arbitrary Go goroutine/process continuation, live database process
continuation, or arbitrary Linux process-image continuation.

## Level 4 inventory

The matrix treats these as first-class Level 4 inventory items:

- sockets;
- epoll;
- eventfd;
- timerfd;
- signalfd;
- pipes;
- ptys;
- credentials;
- namespaces;
- queues;
- readiness;
- partial-transfer state.

Every proof row must show target-native reconstruction and verifier output.
Every unsafe neighbor remains a refusal with `productSupport=unsupported` and
`migrationCompleted=false`.

## Runtime/workload evidence status

The matrix marks workload rows as one of:

- `already-level-4-5-relevant`;
- `level-3-debt-with-migration-path`;
- `level-1-2-supported-by-design`;
- `unsupported-fail-closed`.

Level 3 rows are technical debt unless they name a migration path into Level 4
kernel-resource descriptors or Level 5 native/process translation.

## Product/support rules

The matrix keeps theory and product behavior separate:

- `evidenceStatus` says what the matrix proves or refuses.
- `productSupport` says what users can rely on: `supported`,
  `not-yet-supported`, or `unsupported`.
- `implementationLevel` is the actual supported implementation level. Proof rows
  that are not product support use `not-implemented`.
- `graduationTargetLevel` is the level the proof or refusal is about.

Goal 011 retires semantic Level 2 ping as product support and graduates
`ping-level4-socket-reconstruction-v1` as the first Level 4 portable machine
snapshot workload. The Goal 003 proof row remains historical proof evidence;
the product claim now lives on the portable-machine snapshot path.

Pipes, eventfd, timerfd, TCP listener, Node event-loop, and selected Node Level 5
rows are proof/planning evidence plus refusal rows. They do not create new
supported snapshots. No row may claim success through source-ISA
emulation, sidecar output, metadata-only success, or raw cross-ISA checkpoint
replay.

## Checked evidence

The matrix exercises existing native resource translation recipes for:

- ping/raw ICMP socket reconstruction and refusals;
- pipe pairs and refusals;
- eventfd counters and refusals;
- timerfd one-shot descriptors and refusals;
- TCP listener descriptors and refusals.

It also audits the architecture-portable snapshot gauntlet and requires native
process rows to stay either proof evidence with `productSupport=not-yet-supported`
or refusal evidence with `productSupport=unsupported`. This keeps Level 5
evidence checked without implying product support.
