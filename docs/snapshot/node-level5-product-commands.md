# Node Level 5 product commands

The Node Level 5 product command surface exposes the hardened 80% evidence workflow.

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

Verification checks the manifest, capture summary, restore summary, target log, target-native verifier, behavioral verifier, refusal rows, version info, and triage bundle.

## Inspect registries

```sh
machinen node-level5 claims --json
machinen node-level5 detectors --json
```

The claim registry remains:

```json
{
  "nodeProductSupportClaimed": 80,
  "broadNodeProductSupportClaimed": 20,
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
