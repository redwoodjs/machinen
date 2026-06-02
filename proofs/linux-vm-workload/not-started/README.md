# Whole Linux VM workload portability not started

Status: `defined`

Track: `whole-linux-vm-workload`

Proof directory: `proofs/linux-vm-workload/not-started`

Scope: Whole-VM workload taxonomy is defined, but no whole-VM workload reconstruction claim exists yet. Raw cross-architecture CPU/device VM restore remains refused.

Promotion effect: Requires retained workload-level reconstruction artifacts and retained product refusal boundaries.

Definition:

- `docs/snapshot/whole-linux-vm-workload-taxonomy.md`
- `docs/snapshot/whole-linux-vm-workload-taxonomy.json`

## Claim numbers

```json
{
  "productSupport": 0,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

## Proofs

| Proof                            | Category         | Status     | Artifact                                                                                          | Proves                                                                                                                                           | Claim use                                               | Next                                                                                      |
| -------------------------------- | ---------------- | ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `vm-workload-taxonomy`           | planning         | `defined`  | `docs/snapshot/whole-linux-vm-workload-taxonomy.json`                                             | Defines taxonomy, supported subset, artifact requirements, refusal boundaries, and dashboard claim language                                      | blocks VM workload claim until retained artifacts exist | Build selected-whole-vm-workload-v1 product matrix.                                       |
| `vm-workload-boundary-needed`    | planning         | `verified` | `proofs/linux-vm-workload/boundary-matrix/retained/whole-vm-workload-boundary-matrix-report.json` | Retained boundary matrix validates supported row definitions, refusal boundaries, artifact requirements, forbidden shortcuts, and claim language | definition-only; no claim lift                          | Retain supported direction artifacts and refusal artifacts.                               |
| `vm-sqlite-database-smoke`       | database smoke   | `verified` | `proofs/linux-vm-workload/smoke-matrix/retained/whole-vm-workload-smoke-matrix-report.json`       | Refused with stable `vm-workload-tool-missing`: sqlite3 is not installed in the guest.                                                           | smoke/refusal evidence only; no claim lift              | Provide sqlite3 or a portable DB workload artifact before support.                        |
| `vm-postgresql-database-smoke`   | database smoke   | `verified` | `proofs/linux-vm-workload/smoke-matrix/retained/whole-vm-workload-smoke-matrix-report.json`       | Refused with stable `vm-workload-tool-missing`: PostgreSQL tools are not installed in the guest.                                                 | smoke/refusal evidence only; no claim lift              | Provide PostgreSQL tooling/service artifact before support.                               |
| `vm-simple-c-process-smoke`      | language process | `verified` | `proofs/linux-vm-workload/smoke-matrix/retained/whole-vm-workload-smoke-matrix-report.json`       | Supported: target-native static C binary executed in the VM.                                                                                     | guest smoke evidence only; no claim lift                | Compose into selected-whole-vm-workload-v1 snapshot/restore matrix.                       |
| `vm-simple-java-process-smoke`   | language process | `verified` | `proofs/linux-vm-workload/smoke-matrix/retained/whole-vm-workload-smoke-matrix-report.json`       | Refused with stable `vm-workload-tool-missing`: Java runtime is not installed in the guest.                                                      | smoke/refusal evidence only; no claim lift              | Provide Java runtime/workload artifact before support.                                    |
| `vm-ebpf-capability-smoke`       | kernel feature   | `verified` | `proofs/linux-vm-workload/smoke-matrix/retained/whole-vm-workload-smoke-matrix-report.json`       | Supported: minimal `bpf(BPF_MAP_CREATE)` probe succeeded in the VM.                                                                              | capability smoke evidence only; no claim lift           | Add explicit eBPF workload/refusal matrix before support claims.                          |
| `vm-seccomp-capability-smoke`    | kernel feature   | `verified` | `proofs/linux-vm-workload/smoke-matrix/retained/whole-vm-workload-smoke-matrix-report.json`       | Supported: guest-installed seccomp filter blocked `getpid` with `EPERM`.                                                                         | capability smoke evidence only; no claim lift           | Add seccomp policy reconstruction/refusal matrix before support claims.                   |
| `vm-nested-virtualization-smoke` | virtualization   | `verified` | `proofs/linux-vm-workload/smoke-matrix/retained/whole-vm-workload-smoke-matrix-report.json`       | Refused with stable `vm-workload-nested-virtualization-unavailable`: `/dev/kvm` is missing in the guest.                                         | capability refusal evidence only; no claim lift         | Retain nested virtualization support artifact only when `/dev/kvm` is available and safe. |
