# Node Level 5 framework capability matrix

This matrix tracks framework capability evidence beyond app-row evidence. It does **not** claim arbitrary Express, arbitrary Fastify, arbitrary Node, or arbitrary process cross-architecture restore.

The current claim is:

```json
{
  "nodeProductSupportClaimed": 100,
  "broadNodeProductSupportClaimed": 100,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

## CLI

```sh
machinen node-level5 framework-capabilities --json
machinen node-level5 framework-readiness \
  --framework-introspection-corpus-report ./node-level5-framework-introspection-corpus-report.json \
  --json
machinen node-level5 framework-claim-ready \
  --readiness-report ./node-level5-framework-readiness.json \
  --framework-product-evidence-report ./node-level5-framework-product-evidence-report.json \
  --json
```

## What this adds

The readiness gate checks more than row count. It verifies that every Express/Fastify capability and cross-architecture direction is present, that the rows use the VM-detected product command path, that framework graph artifacts are retained, and that no row claims arbitrary framework, Node, or process support.

The claim-ready gate proves the framework evidence required for the 100 / 100 / 0 claim: Express route/middleware/settings/error-handler graph artifacts, Fastify plugin/decorator/hook/schema/route graph artifacts, restored behavior probes tied to those artifacts, and refusal artifacts for unsafe dynamic/live states.

The matrix separates three ideas:

| Status                    | Meaning                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `supported-selected-rows` | Existing app rows or retained framework product evidence cover selected examples of the capability. |
| `candidate-next-evidence` | Reserved for future evidence beyond the current 100 / 100 / 0 claim.                                |
| `refused`                 | Unsafe live state refuses before snapshot or restore.                                               |
| `not-proven`              | Arbitrary framework app support is not claimed.                                                     |

## Supported framework capability evidence

The current framework evidence captures:

- Express route, middleware, settings, and error-handler graph evidence;
- Fastify plugin, decorator, hook, schema, and route graph evidence;
- restored behavior probes tied to retained graph artifacts;
- refusal artifacts for active requests, worker threads, native addons, TLS active state, and child processes.

These are selected framework-capability rows only. They do not broaden the claim to arbitrary framework apps.
