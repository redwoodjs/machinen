# Node Level 5 app support matrix

This is the internal app-based support matrix for the Node Level 5 product path. It answers whether a **particular app shape** is supported, refused, or still outside the claim. It does not claim arbitrary Express, arbitrary Fastify, arbitrary Node, or raw cross-architecture CPU restore.

The product path remains:

```sh
machinen snapshot node <pid> --out <dir>
machinen restore <dir>
```

## Current app rows

| App row                                   | Framework       |    Status | Product behavior       | Evidence       |
| ----------------------------------------- | --------------- | --------: | ---------------------- | -------------- |
| Express fixture product-run app           | Express         | Supported | snapshot + restore     | Proofs 721–760 |
| Fastify fixture product-run app           | Fastify         | Supported | snapshot + restore     | Proofs 721–760 |
| Express official hello-world template     | Express         | Supported | snapshot + restore     | Proofs 801–840 |
| Express generator router template         | Express         | Supported | snapshot + restore     | Proofs 801–840 |
| Fastify getting-started template          | Fastify         | Supported | snapshot + restore     | Proofs 801–840 |
| Fastify plugin-route template             | Fastify         | Supported | snapshot + restore     | Proofs 801–840 |
| Installed Express hello-world app         | Express         | Supported | snapshot + restore     | Proofs 841–880 |
| Installed Express router app              | Express         | Supported | snapshot + restore     | Proofs 841–880 |
| Installed Fastify getting-started app     | Fastify         | Supported | snapshot + restore     | Proofs 841–880 |
| Installed Fastify plugin-route app        | Fastify         | Supported | snapshot + restore     | Proofs 841–880 |
| Express/Fastify active request apps       | Express/Fastify |   Refused | refuse before snapshot | Proofs 761–800 |
| Express/Fastify worker thread apps        | Express/Fastify |   Refused | refuse before snapshot | Proofs 761–800 |
| Express/Fastify native addon apps         | Express/Fastify |   Refused | refuse before snapshot | Proofs 761–800 |
| Express/Fastify Wasm/external memory apps | Express/Fastify |   Refused | refuse before snapshot | Proofs 761–800 |
| Express/Fastify TLS active state apps     | Express/Fastify |   Refused | refuse before snapshot | Proofs 761–800 |
| Express/Fastify child process apps        | Express/Fastify |   Refused | refuse before snapshot | Proofs 761–800 |
| Express/Fastify filesystem watcher apps   | Express/Fastify |   Refused | refuse before snapshot | Proofs 761–800 |
| Express/Fastify websocket apps            | Express/Fastify |   Refused | refuse before snapshot | Proofs 761–800 |

## Boundaries

| Boundary                            |       Status | Reason                                                                       |
| ----------------------------------- | -----------: | ---------------------------------------------------------------------------- |
| Arbitrary Express app               |  Not claimed | Only listed Express fixture/template/installed app rows are supported today. |
| Arbitrary Fastify app               |  Not claimed | Only listed Fastify fixture/template/installed app rows are supported today. |
| Arbitrary Node process              |  Not claimed | Broad Node state translation is not proven by the app corpus.                |
| Raw cross-arch CPU/register restore | Out of scope | Node Level 5 uses translated continuation, not copied CPU/register state.    |

## CLI

The machine-readable internal matrix is available with:

```sh
machinen node-level5 support-matrix --json
```

Claims remain unchanged:

- Node product support: **80%**
- Broad Node product support: **20%**
- Arbitrary process cross-arch restore: **0%**
