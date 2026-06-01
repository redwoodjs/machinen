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
```

Current retained inputs:

- bidirectional clean Node HTTP product E2E seed: `../real-cross-arch-e2e-gate/retained/`;
- real-app refusal definitions/artifacts: `retained/refusals/real-app-summary.json`;
- generic-VM refusal artifact definitions: `retained/refusals/generic-vm-refusal-artifacts-summary.json`.

Current policy:

- keep `100 / 100 / 0` unverified;
- keep public Node claim at `0 / 0 / 0`;
- treat `proofs/nodejs/real-cross-arch-e2e-gate/` as bidirectional seed evidence only;
- treat retained refusal reports as boundary definitions until every support-matrix refusal row is linked;
- require every supported and refused matrix row to link to retained source/target artifacts before a claim raise.

The row-coverage report lists the exact required paths for each missing supported row under:

```text
proofs/nodejs/claim-evidence-index/retained/row-evidence/supported/<row-id>/<direction>/
```
