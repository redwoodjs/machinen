# Whole VM workload next corpus

This proof defines the next whole-VM workload corpus rows requested after the scoped `selected-whole-vm-workload-v1` claim.

It does **not** broaden the public claim. Current claim remains:

```json
{
  "productSupport": 100,
  "broadSupport": 100,
  "arbitraryProcessCrossArchRestore": 0
}
```

Scope remains `selected-whole-vm-workload-v1 only`.

## Rows added

| Row                                | Status            | Claim effect |
| ---------------------------------- | ----------------- | ------------ |
| SQLite clean DB workload           | `not-started`     | none         |
| PostgreSQL clean workload          | `not-started`     | none         |
| C service workload                 | `not-started`     | none         |
| Java service workload              | `not-started`     | none         |
| Filesystem workload                | `not-started`     | none         |
| Network listener workload          | `not-started`     | none         |
| Multi-process workload             | `not-started`     | none         |
| Dirty/active/opaque state refusals | `refusal-defined` | none         |

Each support row requires retained `arm64 -> amd64` and `amd64 -> arm64` product artifacts before it can affect any broader corpus claim.

Forbidden shortcuts remain blocked:

- raw vCPU replay
- source ISA emulation
- opaque VM/device metadata-only success
- app checkpoint hooks as the source of truth
- sidecar replay

Run:

```sh
bash scripts/smoke/whole-vm-workload-next-corpus.sh
```

Retained report:

- `retained/whole-vm-workload-next-corpus-report.json`
