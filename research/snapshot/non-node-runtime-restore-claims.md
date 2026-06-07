# Non-Node complex runtime restore claims

> **Status: proof-audit.** This is proof/refusal evidence only, not product snapshot/restore support. Use `pnpm run proof-non-node-runtime` only with this status in mind.

Goal 38 starts cautious, proof-backed exploration outside Node.js. It does not
claim broad JVM/Python/Ruby/Go portability. It records concrete local audited
support-or-refusal envelopes with target-native summaries and stable refusal
codes.

## Validated command

```bash
pnpm run proof-non-node-runtime -- --keep --work-dir /tmp/machinen-non-node-runtime
```

## Current results

- JVM/Spring-style: fail-closed on this host because a controlled JDK fixture is
  not available; JIT, classloader, monitor/parked thread, JNI, and JDBC hazards
  have stable refusal families.
- Python Django/Celery-style: local audited stdlib fixture supported for route,
  import graph, sqlite ORM-style persistence, and worker queue behavior. C
  extensions, pending tasks, DB transactions, and external broker state remain
  refused.
- Ruby Rails/Puma-style: local audited stdlib fixture supported for routing,
  ActiveRecord-style persistence, Puma-style thread behavior, gem/autoload graph
  evidence. Native gems, cache drift, autoload ambiguity, and DB transactions
  remain refused.
- Go service/runtime: local audited stdlib fixture supported for goroutine,
  channel, timer, static no-cgo policy, and target-native binary/runtime
  evidence. Active netpoller sockets, channel/select ambiguity, TLS sessions,
  and cgo state remain refused.

## Matrix presets

Checked summaries live in `research/snapshot/checked-summaries/non-node-runtimes/`.

```bash
node scripts/portable-machine-proof-matrix.mjs \
  --preset non-node-runtimes \
  --check-summary-dir research/snapshot/checked-summaries/non-node-runtimes \
  --json
```

Focused presets:

- `runtime-jvm`
- `runtime-python`
- `runtime-ruby`
- `runtime-go`
- `runtime-cross-comparison`

## Recommendation

Python and Go now have follow-on bidirectional `arm64 <-> amd64` repeatability
proofs in [Non-Node cross-architecture restore hardening](./non-node-cross-arch-restore-claims.md).
JVM should wait for a controlled JDK fixture host before support claims are
widened; Ruby needs target hosts or audited runtime bundles before comparable
cross-architecture claims.
