# Whole VM workload boundary matrix

This retained proof validates the definition-only whole-VM workload taxonomy and turns `vm/002` from a missing planning row into an accepted boundary matrix row.

It does **not** run a VM workload and does **not** raise the whole-VM claim. The public claim remains:

```json
{
  "productSupport": 0,
  "broadSupport": 0,
  "arbitraryProcessCrossArchRestore": 0
}
```

The matrix verifies that the taxonomy defines:

- `selected-whole-vm-workload-v1`;
- required supported rows;
- refusal boundaries;
- supported/refusal artifact requirements;
- forbidden shortcuts;
- dashboard claim language.

Run:

```sh
bash scripts/smoke/whole-vm-workload-boundary-matrix.sh
```

Retained report:

- `retained/whole-vm-workload-boundary-matrix-report.json`
