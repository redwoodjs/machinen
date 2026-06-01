# Node Level 5 90 / 30 / 0 milestone

This milestone is now claimed. Machinen moves from **85 / 25 / 0** to **90 / 30 / 0** for Node Level 5 product support.

## Current claim

| Claim                                        | Current value | Meaning                                                                                               |
| -------------------------------------------- | ------------: | ----------------------------------------------------------------------------------------------------- |
| Node product support                         |           90% | Selected Node app rows plus retained Express/Fastify framework capability evidence are release-gated. |
| Broad Node product support                   |           30% | Broad Node remains partial and limited to proven framework capabilities plus refusal boundaries.      |
| Arbitrary process cross-architecture restore |            0% | Machinen does not claim arbitrary process restore.                                                    |

## What changed

The 90 / 30 / 0 claim adds framework capability evidence on top of the VM-first product path:

```sh
machinen snapshot <vm-name> --out <dir>
machinen restore <dir>
```

Machinen still detects supported Node workloads inside the VM. Users do not pass `node` or a host PID on the product path.

## Evidence gates

The claim is backed by:

1. framework capability matrix evidence;
2. framework introspection corpus evidence;
3. framework readiness evidence;
4. retained framework product evidence;
5. framework claim-ready evidence;
6. exact artifact drift guards for 18 graph artifacts, 16 restored behavior probes, 20 refusal artifacts, and 54 total retained framework artifacts.

## Refusal evidence

The following remain refused or outside the product path:

| Boundary                           | Expected result                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Host PID product targeting         | Hidden unless `MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT=1` is set for harnesses. |
| Node-only product selector         | Not part of the public product path.                                                 |
| Active requests                    | Refused before restore claim.                                                        |
| Worker threads                     | Refused.                                                                             |
| Native addons                      | Refused.                                                                             |
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
