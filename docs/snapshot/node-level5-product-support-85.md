# Node Level 5 product support — 85% tier

Machinen now claims **85% Node product support**, **25% broad Node product support**, and **0% arbitrary process cross-architecture restore**.

## Claim

```json
{
  "nodeProductSupportClaimed": 85,
  "broadNodeProductSupportClaimed": 25,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

## What changed from 80 / 20 / 0

The 85 / 25 / 0 claim adds the generic VM-detected Node workload path:

```sh
machinen snapshot <vm-name> --out <dir>
machinen restore <dir>
```

Node is detected inside the VM. Users do not pass a Node-only selector or a host PID on the product path.

## Evidence gates

The claim is backed by these release-gated evidence layers:

- generic VM corpus rows;
- retained VM snapshot/restore evidence;
- per-row generic VM artifacts;
- refusal artifacts for active requests, worker threads, native addons, TLS active state, and child processes;
- the 85 claim-ready gate.

## Support boundary

This claim covers selected app rows only. It does not claim arbitrary Node, arbitrary Express, arbitrary Fastify, or arbitrary process cross-architecture restore.

Raw CPU/register restore, source-ISA emulation, app checkpoint hooks, sidecar replay, selected-state descriptors, and metadata-only success remain outside the product path.
