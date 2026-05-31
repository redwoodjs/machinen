# Node Level 5 app support matrix

This is the internal app-based support matrix for the Node Level 5 product path. It answers whether a **particular app shape** is supported, refused, or not proven. It does not claim arbitrary Express, arbitrary Fastify, arbitrary Node, or raw cross-architecture CPU restore.

The product path remains:

```sh
machinen snapshot node <pid> --out <dir>
machinen restore <dir>
```

## Current app rows

| App row                               | Framework |    Status | Route  | Response | Middleware | Async | Product behavior   | Evidence        |
| ------------------------------------- | --------- | --------: | ------ | -------- | ---------- | ----: | ------------------ | --------------- |
| Express fixture product-run app       | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 721–760  |
| Fastify fixture product-run app       | Fastify   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 721–760  |
| Express official hello-world template | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 801–840  |
| Express generator router template     | Express   | Supported | router | text     | pure JS    |    no | snapshot + restore | Proofs 801–840  |
| Fastify getting-started template      | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 801–840  |
| Fastify plugin-route template         | Fastify   | Supported | plugin | text     | pure JS    |   yes | snapshot + restore | Proofs 801–840  |
| Installed Express hello-world app     | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 841–880  |
| Installed Express router app          | Express   | Supported | router | text     | pure JS    |    no | snapshot + restore | Proofs 841–880  |
| Installed Express JSON response app   | Express   | Supported | simple | JSON     | none       |    no | snapshot + restore | Proofs 961–1000 |
| Installed Express route params app    | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 961–1000 |
| Installed Express query string app    | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 961–1000 |
| Installed Express static asset app    | Express   | Supported | simple | text     | pure JS    |    no | snapshot + restore | Proofs 961–1000 |
| Installed Fastify getting-started app | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 841–880  |
| Installed Fastify plugin-route app    | Fastify   | Supported | plugin | text     | pure JS    |   yes | snapshot + restore | Proofs 841–880  |
| Installed Fastify JSON response app   | Fastify   | Supported | simple | JSON     | none       |   yes | snapshot + restore | Proofs 961–1000 |
| Installed Fastify route params app    | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 961–1000 |
| Installed Fastify query string app    | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 961–1000 |
| Installed Fastify static asset app    | Fastify   | Supported | simple | text     | pure JS    |   yes | snapshot + restore | Proofs 961–1000 |

## Refused app rows

These rows are based on particular Express/Fastify refusal apps. Product behavior is **refuse before snapshot**.

| Feature / state      | Frameworks      |  Status | Evidence       |
| -------------------- | --------------- | ------: | -------------- |
| Active request       | Express/Fastify | Refused | Proofs 761–800 |
| Worker thread        | Express/Fastify | Refused | Proofs 761–800 |
| Native addon         | Express/Fastify | Refused | Proofs 761–800 |
| Wasm/external memory | Express/Fastify | Refused | Proofs 761–800 |
| TLS active state     | Express/Fastify | Refused | Proofs 761–800 |
| Child process        | Express/Fastify | Refused | Proofs 761–800 |
| Filesystem watcher   | Express/Fastify | Refused | Proofs 761–800 |
| Websocket            | Express/Fastify | Refused | Proofs 761–800 |

## Not-proven feature gaps

These rows are intentionally visible in the matrix as `not-proven`; they are not support claims.

| Feature gap               | Frameworks      |     Status | Next evidence needed                   |
| ------------------------- | --------------- | ---------: | -------------------------------------- |
| External network / DB app | Express/Fastify | Not proven | Detector/refusal policy before support |
| Background task app       | Express/Fastify | Not proven | Detector/refusal policy before support |

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
