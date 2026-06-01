# Node Level 5 product commands

The Node Level 5 product command surface exposes the hardened 85% evidence workflow.

## Write an artifact bundle

```sh
machinen node-level5 artifacts write \
  --out ./node-level5-artifacts \
  --family express-fastify-http-app \
  --direction arm64-to-amd64 \
  --json
```

## Verify an artifact bundle

```sh
machinen node-level5 artifacts verify \
  --root ./node-level5-artifacts/express-fastify-http-app/arm64-to-amd64 \
  --family express-fastify-http-app \
  --direction arm64-to-amd64 \
  --json
```

Verification checks the manifest, capture summary, restore summary, target log, target-native verifier, behavioral verifier, refusal rows, version info, and triage bundle. The manifest is version-gated and records SHA-256 hashes for every retained artifact except itself; verification refuses missing files, corrupt JSON, family/direction mismatches, unsupported schema versions, and tampered files.

## Inspect registries

```sh
machinen node-level5 claims --json
machinen node-level5 detectors --json
machinen node-level5 release-gate \
  --root ./node-level5-artifacts/express-fastify-http-app/arm64-to-amd64 \
  --family express-fastify-http-app \
  --direction arm64-to-amd64 \
  --json

machinen node-level5 release-gate \
  --include-generic-vm-corpus \
  --generic-vm-corpus-report ./node-level5-generic-vm-corpus-report.json \
  --json

machinen node-level5 release-gate \
  --include-generic-vm-retained-evidence \
  --generic-vm-retained-evidence-report ./node-level5-generic-vm-retained-evidence-report.json \
  --json

machinen node-level5 release-gate \
  --include-generic-vm-row-artifacts \
  --generic-vm-row-artifacts-report ./node-level5-generic-vm-row-artifacts-report.json \
  --json

machinen node-level5 release-gate \
  --include-generic-vm-refusal-artifacts \
  --generic-vm-refusal-artifacts-report ./node-level5-generic-vm-refusal-artifacts-report.json \
  --json

machinen node-level5 85-readiness \
  --generic-vm-corpus-report ./node-level5-generic-vm-corpus-report.json \
  --generic-vm-retained-evidence-report ./node-level5-generic-vm-retained-evidence-report.json \
  --generic-vm-row-artifacts-report ./node-level5-generic-vm-row-artifacts-report.json \
  --generic-vm-refusal-artifacts-report ./node-level5-generic-vm-refusal-artifacts-report.json \
  --json > ./node-level5-85-readiness.json

machinen node-level5 85-claim-ready \
  --readiness-report ./node-level5-85-readiness.json \
  --json
```

The generic VM corpus, retained-evidence, row-artifact, refusal-artifact, framework capability, product-evidence, and claim-ready gates are now treated as proof substrate only. They do not back a public Node percentage claim until the real cross-architecture VM E2E gate in `proofs/nodejs/real-cross-arch-e2e-gate/` passes with retained artifacts. Arbitrary process support remains 0.

The arbitrary-process seed track is diagnostic evidence only:

```sh
machinen node-level5 arbitrary-process-seed --json
machinen node-level5 arbitrary-process-seed --out ./arbitrary-process-seed --json
```

The claim registry is now:

```json
{
  "nodeProductSupportClaimed": 0,
  "broadNodeProductSupportClaimed": 0,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

## ABI check

```sh
machinen node-level5 abi-check \
  --node "22.x" \
  --v8 "12.x pointer-compressed" \
  --libuv "supported idle handles plus selected hard-facility boundaries" \
  --json
```

Unknown Node/V8/libuv ABI values refuse before target start.

## Retained artifact safety

Imported artifact roots must not contain path traversal segments such as `..`. The verifier ignores artifact paths from the manifest and uses the product-defined file names under the supplied root. This keeps retained bundle ingestion tied to the declared artifact directory instead of allowing a bundle to point the verifier at arbitrary host paths.
