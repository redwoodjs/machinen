# Node Level 5 90 / 30 / 0 support

Machinen now claims **90 / 30 / 0** for Node Level 5 product support.

| Claim                                        | Value | Meaning                                                                                               |
| -------------------------------------------- | ----: | ----------------------------------------------------------------------------------------------------- |
| Node product support                         |   90% | Selected Node app rows plus retained Express/Fastify framework capability evidence are release-gated. |
| Broad Node product support                   |   30% | Broad Node remains partial and bounded by framework capability evidence plus refusal artifacts.       |
| Arbitrary process cross-architecture restore |    0% | Machinen does not claim arbitrary process restore.                                                    |

## Product path

The product path remains VM-first:

```sh
machinen snapshot <vm-name> --out <dir>
machinen restore <dir>
```

Machinen detects supported Node workloads inside the VM. Host PID snapshot remains harness-only behind `MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT=1`.

## Evidence

The 90 / 30 / 0 claim is backed by the framework claim-ready gate. That gate requires:

- framework capability matrix evidence;
- framework introspection corpus evidence;
- framework readiness evidence;
- retained framework product evidence;
- framework claim-ready evidence.

The retained framework product evidence includes:

- Express route, middleware, settings, and error-handler graph artifacts;
- Fastify plugin, decorator, hook, schema, and route graph artifacts;
- restored behavior probes tied to those artifacts;
- refusal artifacts for active requests, worker threads, native addons, TLS active state, and child processes.

## Required counts

| Artifact type                      | Required count |
| ---------------------------------- | -------------: |
| Framework graph artifacts          |             18 |
| Restored behavior probes           |             16 |
| Unsafe-state refusal artifacts     |             20 |
| Total retained framework artifacts |             54 |

## Boundaries

This claim does not mean arbitrary Express support, arbitrary Fastify support, arbitrary Node support, or arbitrary process cross-architecture restore. Unsupported live and dynamic states remain refused before snapshot or restore claim.
