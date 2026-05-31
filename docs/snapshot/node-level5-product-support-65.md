# Node Level 5 product support — 65% tier

Machinen now has a 65% Node product support tier for fourteen declared service and boundary families. This is the first tier that moves broad Node product support above zero, but only to 5%.

## Claim

```json
{
  "nodeProductSupportClaimed": 65,
  "nodeProductSupportScope": "fourteen-service-and-boundary-families",
  "previousNodeProductSupportClaimed": 50,
  "newNodeProductSupportClaimed": 15,
  "broadNodeProductSupportClaimed": 5,
  "broadNodeProductSupportScope": "selected-hard-facility-boundaries",
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

## New 15% families

Each new family contributes 5% to the Node product support claim.

| Family                     | Included                                                                                          | Excluded                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Active async idle boundary | Idle async resources, completed callbacks, empty active work queue.                               | In-flight async operations, pending callbacks, active promise reactions. |
| TLS boundary policy        | Clear refusal of live TLS state, target-native TCP fallback boundary, retained refusal artifacts. | Full TLS session migration, in-flight encrypted records.                 |
| Child process boundary     | No live child process at restore, completed child exit state, stable stdio descriptors.           | Live child process continuation, process tree migration.                 |

## Why broad Node is 5%

These families address hard broad Node facilities directly: active async work, TLS, and child processes. The support is still partial and tightly scoped. It does not mean broad Node apps are generally supported.

## Product boundary

This tier still refuses raw CPU restore, source ISA emulation, app checkpoint hooks, metadata-only success, live TLS migration, in-flight async operations, live child process continuation, workers, native addons, and Wasm.
