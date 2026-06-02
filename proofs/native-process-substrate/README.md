# Native process substrate proof gate

This proof group retains proof-only evidence for the 12 indexed native substrate
rows (`native/001` through `native/012`). It verifies register translation,
memory-map inventory, writable memory materialization, stack reconstruction,
bootstrap metadata, runtime/linker boundaries, single-thread policy, active
syscall refusal, page-protection metadata, dirty-memory relocation/refusal,
futex/thread refusal, and JIT/code-page refusal.

The gate is intentionally not a product claim for arbitrary Linux process
cross-architecture restore. The public arbitrary-process claim remains `0` until
raw CPU state, process memory, thread state, syscall state, kernel resources,
and runtime/code-page hazards have retained target-native reconstruction proofs.

Run:

```sh
bash scripts/smoke/native-substrate-gate.sh
```

Retained substrate outputs:

- `proofs/native-process-substrate/retained/native-substrate-gate-report.json`
- `proofs/native-process-substrate/retained/raw/*.json`
- `proofs/native-process-substrate/retained/row-proofs/*/row-proof.json`

Resource and harness outputs:

- `proofs/native-process-substrate/regular-file-fd-bidirectional/retained/native-regular-file-fd-bidirectional-proof-report.json`
- `proofs/native-process-substrate/resource-coverage/retained/native-resource-coverage-matrix-report.json`
- `proofs/native-process-substrate/selected-workload-e2e/retained/native-selected-workload-e2e-report.json`
