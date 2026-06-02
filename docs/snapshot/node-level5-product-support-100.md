# Node Level 5 100 / 100 / 0 support — selected service claim

The Node `100 / 100 / 0` public claim is accepted only for the selected Node service support matrix. It does **not** claim arbitrary Node applications or arbitrary Linux process cross-architecture restore.

## Current public claim

```json
{
  "nodeProductSupportClaimed": 100,
  "broadNodeProductSupportClaimed": 100,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

## Why this is claim-bearing

The consolidated retained gate now links every supported Node support-matrix row to bidirectional real product E2E artifacts and every refused row to retained refusal artifacts.

Required gate:

- `proofs/nodejs/claim-evidence-index/retained/node-claim-row-coverage-report.json`
- `proofs/nodejs/claim-evidence-index/retained/node-claim-evidence-index-report.json`

The gate must remain at:

- supported direction bundles: `144 / 144`
- refused direction artifacts: `84 / 84`
- not-proven blockers: `0`

Arbitrary Linux process cross-architecture restore remains `0%`.
