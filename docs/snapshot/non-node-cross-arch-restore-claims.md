# Non-Node cross-architecture restore hardening

Goal 39 strengthens the Goal 38 non-Node envelope for Python and Go with live,
repeatable, target-native `arm64 <-> amd64` proofs.

## Validated command

```bash
pnpm smoke-non-node-cross-arch -- --keep --work-dir /tmp/goal39-cross --iterations 3
```

Default hosts:

- arm64: `friend@100.126.46.90`
- amd64: `root@192.168.0.8`

## Proven routes

- Python Django/Celery-style fixture:
  - `arm64 -> amd64`
  - `amd64 -> arm64`
  - three repeat executions per host with stable semantic fingerprints
- Go service/runtime fixture:
  - `arm64 -> amd64`
  - `amd64 -> arm64`
  - three repeat executions per host with stable semantic fingerprints
  - target-native static Linux binaries, `CGO_ENABLED=0`, one binary per target
    architecture

## Guardrails retained

The proof still does not claim arbitrary Python or Go process migration. The
checked summaries require:

- `migrationCompleted=true` only for the proven subsets;
- no source-ISA emulation;
- no source-text-replay shortcut success;
- no sidecar runtime;
- no app restore hooks;
- stable refusal boundaries for C extensions, cgo, active sockets, pending
  tasks, DB transactions, TLS sessions, and ambiguous scheduler/channel state.

## Matrix presets

```bash
node scripts/portable-machine-proof-matrix.mjs \
  --preset non-node-cross-arch \
  --check-summary-dir docs/snapshot/checked-summaries/non-node-cross-arch \
  --json
```

Focused presets:

- `runtime-python-cross-arch`
- `runtime-go-cross-arch`

## Next stability work

- Add controlled JDK hosts for JVM/Spring-style support beyond fail-closed.
- Add Ruby hosts or audited Ruby runtime bundles for Rails/Puma-style
  cross-architecture proof.
- Add offline dependency repositories: Python wheelhouse, vendored Go modules,
  Ruby gem repo, and Maven/Gradle cache.
