# Node Level 5 85 / 25 / 0 milestone

This milestone is now claimed. Machinen moves from **80 / 20 / 0** to **85 / 25 / 0** for Node Level 5 product support.

## Current claim

| Claim                                        | Current value | Meaning                                                                            |
| -------------------------------------------- | ------------: | ---------------------------------------------------------------------------------- |
| Node product support                         |           85% | Selected Node service/app rows have VM-first product-path evidence.                |
| Broad Node product support                   |           25% | Broad Node remains partial and limited to proven app rows plus refusal boundaries. |
| Arbitrary process cross-architecture restore |            0% | Machinen does not claim arbitrary process restore.                                 |

## What changed

The 85 / 25 / 0 claim adds the generic VM-first product path:

```sh
machinen snapshot <vm-name> --out <dir>
machinen restore <dir>
```

Machinen detects supported Node workloads inside the VM. Users do not pass `node` or a host PID on the product path.

## Evidence gates

The claim is backed by:

1. product-path rows for the generic VM snapshot command;
2. a release-gated generic VM corpus report for both cross-architecture directions;
3. positive and negative support-matrix rows;
4. drift guards for the 114 / 68 / 42 / 4 matrix counts;
5. a VM smoke that boots a Node workload, snapshots the VM with generic `--out`, restores the snapshot, and verifies behavior;
6. retained generic VM evidence;
7. per-row generic VM artifacts;
8. generic VM refusal artifacts;
9. the 85 claim-ready gate.

## Refusal evidence

The following remain refused or outside the product path:

| Boundary                           | Expected result                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Host PID product targeting         | Hidden unless `MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT=1` is set for harnesses. |
| Node-only product selector         | Not part of the public product path.                                                 |
| Active requests                    | Refused before restore claim.                                                        |
| Worker threads                     | Refused.                                                                             |
| Native addons                      | Refused.                                                                             |
| Wasm / external memory             | Refused.                                                                             |
| TLS active state                   | Refused.                                                                             |
| Child processes                    | Refused.                                                                             |
| Source ISA emulation               | Refused.                                                                             |
| Raw CPU restore as Level 5 support | Refused.                                                                             |
| Metadata-only success              | Refused.                                                                             |

## Non-goals

- Do not claim arbitrary Node app support.
- Do not claim arbitrary Express or Fastify support.
- Do not use app-exported state, checkpoint hooks, selected-state descriptors, sidecar replay, source-ISA emulation, or metadata-only success.
- Do not implement runtime-profile snapshot/restore as the product path.
- Do not raise arbitrary process cross-architecture restore above `0%`.
