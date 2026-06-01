# Node Level 5 framework capability matrix

This matrix starts the path beyond app-row evidence. It does **not** claim arbitrary Express, arbitrary Fastify, arbitrary Node, or arbitrary process cross-architecture restore.

The current claim remains:

```json
{
  "nodeProductSupportClaimed": 85,
  "broadNodeProductSupportClaimed": 25,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

The next candidate target is **90 / 30 / 0**, but it is not claimed.

## CLI

```sh
machinen node-level5 framework-capabilities --json
machinen node-level5 framework-readiness \
  --framework-introspection-corpus-report ./node-level5-framework-introspection-corpus-report.json \
  --json
```

## What this adds

The readiness gate now checks more than row count. It verifies that every Express/Fastify capability and cross-architecture direction is present, that the rows use the VM-detected product command path, that framework graph artifacts are retained, and that no row claims arbitrary framework, Node, or process support.

The matrix separates three ideas:

| Status                    | Meaning                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `supported-selected-rows` | Existing app-support rows cover selected examples of the capability.                                          |
| `candidate-next-evidence` | We need framework introspection and retained framework graph evidence before this can support a future claim. |
| `refused`                 | Unsafe live state refuses before snapshot or restore.                                                         |
| `not-proven`              | Arbitrary framework app support is not claimed.                                                               |

## Candidate capabilities

The next evidence path should capture framework-level metadata inside the VM:

- Express route and middleware graph evidence;
- Fastify route, hook, decorator, and plugin graph evidence;
- idle lifecycle state evidence;
- explicit refusals for active requests, worker threads, native addons, TLS active state, and child processes.

These are candidate framework-capability rows only. They do not broaden the product claim until release gates prove them.
