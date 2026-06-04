# Whole VM workload corpus proof

This retained proof runs the requested next-corpus workload probes in real Machinen Linux VMs on both target architectures:

- local `arm64`
- remote `amd64`

It does **not** broaden the public product claim. Current claim remains:

```json
{
  "productSupport": 100,
  "broadSupport": 100,
  "arbitraryProcessCrossArchRestore": 0
}
```

Scope remains `selected-whole-vm-workload-v1 only`.

## Result

| Row                                | Disposition           | Evidence                                                                                            |
| ---------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| SQLite clean DB workload           | refused               | `sqlite3` is missing in both guests                                                                 |
| PostgreSQL clean workload          | refused               | PostgreSQL tools are missing in both guests                                                         |
| C service workload                 | supported, proof-only | target-native static C verifier passed on arm64 and amd64                                           |
| Java service workload              | refused               | Java runtime is missing in both guests                                                              |
| Filesystem workload                | supported, proof-only | file tree create/copy/read verifier passed on arm64 and amd64                                       |
| Network listener workload          | supported, proof-only | loopback listener request/response verifier passed on arm64 and amd64                               |
| Multi-process workload             | supported, proof-only | fork/pipe child verifier passed on arm64 and amd64                                                  |
| Dirty/active/opaque state refusals | refusal-defined       | retained refusal code for dirty DB, active session, opaque kernel/device, and runtime-private state |

`productSupportRowsAdded` remains `0` because these are workload probes/refusals, not product `machinen snapshot` / `machinen restore` support matrices for those rows.

Run:

```sh
bash scripts/smoke/whole-vm-workload-corpus-proof.sh
```

Retained report:

- `retained/whole-vm-workload-corpus-proof-report.json`
