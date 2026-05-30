# Node Level 5 product support — 20% tier

Machinen now has a 20% Node product support tier for a small set of idle service families. This is not broad Node product support.

## Claim

```json
{
  "nodeProductSupportClaimed": 20,
  "nodeProductSupportScope": "five-idle-service-families",
  "declaredSubsetExperimentalProductSupportClaimed": 100,
  "broadNodeProductSupportClaimed": 0,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

## Supported families

Each supported family contributes 4% to the Node product support claim.

| Family                        | Included                                                          | Excluded                                             |
| ----------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| Idle HTTP listener            | Server socket open, idle event loop, no active request in flight. | Active requests, TLS, keepalive edge cases.          |
| Timer service                 | Idle timers with known remaining and interval state.              | Active timer callbacks, pending microtasks.          |
| Plain JavaScript heap         | Strings, arrays, plain objects, closure contexts.                 | External memory, native addon objects, Wasm modules. |
| Readonly file / stdio         | Readonly file descriptors, stdin, stdout, stderr.                 | Dirty writable file state, filesystem watchers.      |
| Pipes / streams idle boundary | Idle pipe and stream descriptors with no active read or write.    | Backpressure in flight, active stream callbacks.     |

## Required product evidence

The 20% tier requires:

- Exact product contract for each family.
- Real guarded end-to-end evidence for each family.
- Bidirectional cross-architecture evidence for `arm64 -> amd64` and `amd64 -> arm64`.
- Target-native verification that restored state exists on the target.
- CI-style artifact retention.
- Public docs and support runbook.
- Stable refusal codes for unsupported neighbors.
- Version pins for Node `22.x`, V8 `12.x pointer-compressed`, and supported idle libuv handles.

## Unsupported neighbors

The following remain outside the product tier and must refuse before target start:

- Active requests.
- TLS.
- Worker threads.
- Native addons.
- Wasm modules.
- External memory.
- Filesystem watchers.
- Raw CPU restore.
- Source ISA emulation.

## Product boundary

This tier supports five named idle Node service families. It does not support broad Node, arbitrary Node apps, or arbitrary process cross-architecture restore.
