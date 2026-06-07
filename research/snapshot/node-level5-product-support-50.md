# Node Level 5 product support — 50% tier

Machinen now has a 50% Node product support tier for eleven declared service families. This is still not broad Node product support.

## Claim

```json
{
  "nodeProductSupportClaimed": 50,
  "nodeProductSupportScope": "eleven-service-families",
  "previousNodeProductSupportClaimed": 20,
  "newNodeProductSupportClaimed": 30,
  "broadNodeProductSupportClaimed": 0,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

## Existing 20% families

The 50% tier includes the five existing idle service families:

- Idle HTTP listener.
- Timer service.
- Plain JavaScript heap.
- Readonly file / stdio.
- Pipes / streams at idle boundary.

## New 30% families

Each new family contributes 5% to the Node product support claim.

| Family                               | Included                                                              | Excluded                                         |
| ------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------ |
| HTTP keepalive idle pool             | Idle keepalive sockets, no active request, stable listener ownership. | Active requests, TLS session state.              |
| Completed microtask checkpoint       | Completed microtask queue and empty pending microtask set.            | Pending microtasks, active promise reactions.    |
| Promise / async closure graph        | Settled promises, idle async closures, plain closure contexts.        | Active async work, in-flight awaits.             |
| CommonJS / ESM module cache          | Stable module cache and resolved module namespace objects.            | Dynamic loader hooks, native addons.             |
| JSON / config / data heap graph      | Pure data objects, JSON-compatible graphs, configuration snapshots.   | External memory, Wasm, native bindings.          |
| Graceful shutdown / server lifecycle | Idle lifecycle flags, registered close path, stable server state.     | Child processes, worker threads, custom signals. |

## Required evidence

The 50% tier requires:

- Exact product contracts for all eleven service families.
- Real guarded end-to-end evidence for the six new families.
- Bidirectional cross-architecture evidence for `arm64 -> amd64` and `amd64 -> arm64` across all families.
- Target-native verification for all supported families.
- Repeatability and artifact diff stability.
- CI-style artifact retention.
- Public docs, compatibility matrix, release checklist, and support runbook.
- Stable refusal of unsupported neighbors.

## Unsupported neighbors

The following remain outside this product tier and must refuse before target start:

- Pending microtasks.
- Active async work.
- TLS.
- Dynamic loader hooks.
- Child processes.
- Custom signals.
- Worker threads.
- Native addons.
- Wasm modules.
- External memory.
- Raw CPU restore.
- Source ISA emulation.

## Product boundary

This tier supports eleven named Node service families. It does not support broad Node, arbitrary Node apps, or arbitrary process cross-architecture restore.
