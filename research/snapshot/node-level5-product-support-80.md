# Node Level 5 product support — 80% tier

Machinen now has an 80% Node product support tier for seventeen declared service, app, and boundary families. Broad Node product support is still partial and is claimed at 20%.

## Claim

```json
{
  "nodeProductSupportClaimed": 80,
  "nodeProductSupportScope": "seventeen-service-app-and-boundary-families",
  "previousNodeProductSupportClaimed": 65,
  "newNodeProductSupportClaimed": 15,
  "broadNodeProductSupportClaimed": 20,
  "broadNodeProductSupportScope": "real-app-corpus-plus-selected-hard-facility-boundaries",
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

## Real VM cross-architecture evidence

Every supported family must have retained evidence for both directions:

- `arm64 -> amd64`
- `amd64 -> arm64`

Each evidence bundle must include:

- Manifest.
- Capture summary.
- Restore summary.
- Target logs.
- Target-native Node verifier output.
- Behavioral verifier output.
- Refusal rows for unsafe neighbors.
- Version info.

The evidence must show no raw CPU restore, no source ISA emulation, no app checkpoint hooks, and no metadata-only success.

## New 15% real app families

Each new family contributes 5% to the Node product support claim.

| Family                         | Included                                                                   | Excluded                                                                 |
| ------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Express/Fastify-style HTTP app | Routing table, middleware closure graph, idle HTTP service state.          | Active requests, TLS active state, worker-backed routes.                 |
| Dependency-heavy app           | Stable package dependency graph, CommonJS/ESM cache, pure JS config state. | Native addons, dynamic loader hooks, postinstall native state.           |
| Streams/files mixed app        | Idle streams, readonly files, stable pipe boundaries.                      | Active stream callbacks, dirty writable file state, filesystem watchers. |

## Refused broad neighbors

The following remain refused before target start:

- Worker threads.
- Native addons.
- Wasm / external memory.
- TLS active state.
- Active async in-flight work.
- Child process live state.
- Raw CPU restore.
- Source ISA emulation.

## Product boundary

This tier supports seventeen named families with real bidirectional VM evidence requirements. It does not support arbitrary Node apps or arbitrary process cross-architecture restore.
