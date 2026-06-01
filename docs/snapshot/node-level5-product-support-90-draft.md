# Node Level 5 90 / 30 / 0 draft

This is a draft claim target, not a public claim.

The current public claim remains **85 / 25 / 0**:

| Claim                                        | Current | Draft target |
| -------------------------------------------- | ------: | -----------: |
| Node product support                         |     85% |          90% |
| Broad Node product support                   |     25% |          30% |
| Arbitrary process cross-architecture restore |      0% |           0% |

## Product path

The draft target keeps the VM-first product path:

```sh
machinen snapshot <vm-name> --out <dir>
machinen restore <dir>
```

Machinen detects Node inside the VM. Host PID snapshot remains harness-only behind `MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT=1`.

## Required evidence

The draft target requires all of the following before any future claim PR raises the public numbers:

1. framework capability matrix evidence;
2. framework introspection corpus evidence;
3. framework readiness evidence;
4. retained framework product evidence;
5. framework claim-ready evidence.

The retained framework product evidence must include:

- Express route, middleware, settings, and error-handler graph artifacts;
- Fastify plugin, decorator, hook, schema, and route graph artifacts;
- restored behavior probes tied to those graph artifacts;
- refusal artifacts for active requests, worker threads, native addons, TLS active state, and child processes.

## Required counts

| Artifact type                      | Required count |
| ---------------------------------- | -------------: |
| Framework graph artifacts          |             18 |
| Restored behavior probes           |             16 |
| Unsafe-state refusal artifacts     |             20 |
| Total retained framework artifacts |             54 |

## Boundaries

The draft does not claim arbitrary Express apps, arbitrary Fastify apps, arbitrary Node apps, or arbitrary process cross-architecture restore.

`claimChangeAllowed` remains `false` for the draft artifact. A later claim PR must explicitly update the public claim and keep arbitrary process restore at `0%`.
