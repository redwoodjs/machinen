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

| Proof                         | Category | Status     | Artifact                                                                                          | Proves                                                                                                                                           | Claim use                                               | Next                                                        |
| ----------------------------- | -------- | ---------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ----------------------------------------------------------- |
| `vm-workload-taxonomy`        | planning | `defined`  | `docs/snapshot/whole-linux-vm-workload-taxonomy.json`                                             | Defines taxonomy, supported subset, artifact requirements, refusal boundaries, and dashboard claim language                                      | blocks VM workload claim until retained artifacts exist | Build selected-whole-vm-workload-v1 product matrix.         |
| `vm-workload-boundary-needed` | planning | `verified` | `proofs/linux-vm-workload/boundary-matrix/retained/whole-vm-workload-boundary-matrix-report.json` | Retained boundary matrix validates supported row definitions, refusal boundaries, artifact requirements, forbidden shortcuts, and claim language | definition-only; no claim lift                          | Retain supported direction artifacts and refusal artifacts. |
