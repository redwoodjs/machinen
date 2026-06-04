# Node claim evidence index

Status: `claim-facing-index`

This is the single claim-facing consolidation point for the Node proof corpus.

The numbered proofs stay sharded so they remain useful as small regression proofs. Public claims, however, must flow through this index and the retained E2E gates. A checked summary, release-gate summary, unit/facade report, or numbered proof is not claim-bearing unless this index links it to retained product E2E artifacts.

Run the index and row-coverage reports:

```sh
bash scripts/smoke/node-claim-evidence-index.sh
bash scripts/smoke/node-claim-row-coverage.sh
```

The generated reports are retained at:

```text
proofs/nodejs/claim-evidence-index/retained/node-claim-evidence-index-report.json
proofs/nodejs/claim-evidence-index/retained/node-claim-row-coverage-report.json
proofs/nodejs/claim-evidence-index/retained/node-claim-boundary-guard-report.json
proofs/nodejs/claim-evidence-index/retained/node-row-verifier-integrity-report.json
proofs/nodejs/claim-evidence-index/retained/node-artifact-integrity-manifest.json
```

Current retained inputs:

- bidirectional clean Node HTTP product E2E seed: `../real-cross-arch-e2e-gate/retained/`;
- real-app refusal definitions/artifacts: `retained/refusals/real-app-summary.json`;
- generic-VM refusal artifact definitions: `retained/refusals/generic-vm-refusal-artifacts-summary.json`.

Current policy:

- selected Node service support is claim-bearing at `100 / 100 / 0` only while this retained gate accepts;
- arbitrary Node applications/processes and arbitrary Linux process cross-architecture restore remain `0 / 0 / 0`;
- require every supported matrix row to link to retained source/target artifacts and accepted target verifiers;
- require every refused matrix row to link to retained refusal artifacts;
- require the boundary guard, verifier-integrity report, and artifact-integrity manifest to stay accepted before future claim changes.

The row-coverage report lists the exact required paths for each missing supported row under:

```text
proofs/nodejs/claim-evidence-index/retained/row-evidence/supported/<row-id>/<direction>/
```
