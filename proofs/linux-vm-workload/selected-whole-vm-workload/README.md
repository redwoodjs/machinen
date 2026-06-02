# Selected whole-VM workload support matrix

This proof lifts the whole Linux VM workload claim only for the declared subset:

- subset: `selected-whole-vm-workload-v1`
- workload profile: `ping-level4-socket-reconstruction-v1`
- surface: `MACHINEN_SNAPSHOT_ENGINE=portable machinen snapshot` / `machinen restore <bundle> --target-arch <arch>`

The retained matrix proves both product directions:

- `arm64 -> amd64`
- `amd64 -> arm64`

Each direction retains:

- source capture transcript
- portable workload bundle
- portable transport/manifest/resource descriptors
- target verifier input
- target VM restore transcript
- target VM restore summary with `targetVmStarted: true` and `targetOutputObserved: true`

## Claim

Scoped claim after this proof:

```json
{
  "productSupport": 100,
  "broadSupport": 100,
  "arbitraryProcessCrossArchRestore": 0
}
```

This means `100 / 100 / 0` **only** for `selected-whole-vm-workload-v1`.

It does not mean arbitrary VM restore, raw cross-ISA VM-state replay, source ISA emulation, arbitrary Linux process restore, active network connection migration, or opaque guest kernel/device-state migration.

## Run

Validate retained artifacts:

```sh
bash scripts/smoke/selected-whole-vm-workload-support-matrix.sh
```

Retained report:

- `retained/selected-whole-vm-workload-support-matrix-report.json`
