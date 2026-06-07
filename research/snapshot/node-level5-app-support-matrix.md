# Node Level 5 app support matrix

This is the internal app-based support matrix for the Node Level 5 product path. It answers whether a **particular app shape** is supported, refused, or not proven. It does not claim arbitrary Express, arbitrary Fastify, arbitrary Node, or raw cross-architecture CPU restore.

The product path remains:

```sh
machinen snapshot <vm-name> --out <dir>
machinen restore <dir>
```

## Current app rows

Current matrix totals: **114** rows, with **68** supported, **42** refused, and **4** not-proven. Claims are now **85 / 25 / 0**.

| App row                                       | Framework |    Status | Route  | Response | Middleware | Async | Product behavior   | Evidence          |
| --------------------------------------------- | --------- | --------: | ------ | -------- | ---------- | ----: | ------------------ | ----------------- |
| Express fixture product-run app               | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 721–760    |
| Fastify fixture product-run app               | Fastify   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 721–760    |
| Express official hello-world template         | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 801–840    |
| Express generator router template             | Express   | Supported | router | text     | pure JS    |    no | snapshot + restore | Proofs 801–840    |
| Fastify getting-started template              | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 801–840    |
| Fastify plugin-route template                 | Fastify   | Supported | plugin | text     | pure JS    |   yes | snapshot + restore | Proofs 801–840    |
| Installed Express hello-world app             | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 841–880    |
| Installed Express router app                  | Express   | Supported | router | text     | pure JS    |    no | snapshot + restore | Proofs 841–880    |
| Installed Express JSON response app           | Express   | Supported | simple | JSON     | none       |    no | snapshot + restore | Proofs 961–1000   |
| Installed Express route params app            | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 961–1000   |
| Installed Express query string app            | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 961–1000   |
| Installed Express static asset app            | Express   | Supported | simple | text     | pure JS    |    no | snapshot + restore | Proofs 961–1000   |
| Installed Express idle timer app              | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1121–1160  |
| Installed Express safe outbound reconnect app | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1161–1200  |
| Installed Express POST JSON body app          | Express   | Supported | simple | text     | pure JS    |    no | snapshot + restore | Proofs 1201–1240  |
| Installed Express custom request header app   | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1201–1240  |
| Installed Express PUT route app               | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1201–1240  |
| Installed Express DELETE route app            | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1201–1240  |
| Installed Express cookie read app             | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1241–1280  |
| Installed Express status code app             | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1241–1280  |
| Installed Express redirect response app       | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1241–1280  |
| Installed Express response header app         | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1241–1280  |
| Installed Express middleware chain app        | Express   | Supported | simple | text     | pure JS    |    no | snapshot + restore | Proofs 1281–1320  |
| Installed Express not-found handler app       | Express   | Supported | simple | text     | pure JS    |    no | snapshot + restore | Proofs 1281–1320  |
| Installed Express error handler app           | Express   | Supported | simple | text     | pure JS    |    no | snapshot + restore | Proofs 1281–1320  |
| Installed Express request ID propagation app  | Express   | Supported | simple | text     | pure JS    |    no | snapshot + restore | Proofs 1281–1320  |
| Installed Express nested router app           | Express   | Supported | router | text     | pure JS    |    no | snapshot + restore | Proofs 1321–1360  |
| Installed Express optional param app          | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1321–1360  |
| Installed Express multi-route app             | Express   | Supported | router | text     | pure JS    |    no | snapshot + restore | Proofs 1321–1360  |
| Installed Express static cache header app     | Express   | Supported | simple | text     | pure JS    |    no | snapshot + restore | Proofs 1321–1360  |
| Installed Express env read app                | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1361–1400  |
| Installed Express config JSON read app        | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1361–1400  |
| Installed Express feature flag env app        | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1361–1400  |
| Installed Express configured prefix app       | Express   | Supported | router | text     | pure JS    |    no | snapshot + restore | Proofs 1361–1400  |
| Installed Express health-check app            | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Proofs 1401–1420  |
| Installed Fastify getting-started app         | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 841–880    |
| Installed Fastify plugin-route app            | Fastify   | Supported | plugin | text     | pure JS    |   yes | snapshot + restore | Proofs 841–880    |
| Installed Fastify JSON response app           | Fastify   | Supported | simple | JSON     | none       |   yes | snapshot + restore | Proofs 961–1000   |
| Installed Fastify route params app            | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 961–1000   |
| Installed Fastify query string app            | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 961–1000   |
| Installed Fastify static asset app            | Fastify   | Supported | simple | text     | pure JS    |   yes | snapshot + restore | Proofs 961–1000   |
| Installed Fastify idle timer app              | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1121–1160  |
| Installed Fastify safe outbound reconnect app | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1161–1200  |
| Installed Fastify POST JSON body app          | Fastify   | Supported | simple | text     | pure JS    |   yes | snapshot + restore | Proofs 1201–1240  |
| Installed Fastify custom request header app   | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1201–1240  |
| Installed Fastify PUT route app               | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1201–1240  |
| Installed Fastify DELETE route app            | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1201–1240  |
| Installed Fastify cookie read app             | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1241–1280  |
| Installed Fastify status code app             | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1241–1280  |
| Installed Fastify redirect response app       | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1241–1280  |
| Installed Fastify response header app         | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1241–1280  |
| Installed Fastify hook chain app              | Fastify   | Supported | simple | text     | pure JS    |   yes | snapshot + restore | Proofs 1281–1320  |
| Installed Fastify not-found handler app       | Fastify   | Supported | simple | text     | pure JS    |   yes | snapshot + restore | Proofs 1281–1320  |
| Installed Fastify error handler app           | Fastify   | Supported | simple | text     | pure JS    |   yes | snapshot + restore | Proofs 1281–1320  |
| Installed Fastify request ID propagation app  | Fastify   | Supported | simple | text     | pure JS    |   yes | snapshot + restore | Proofs 1281–1320  |
| Installed Fastify prefix route app            | Fastify   | Supported | router | text     | pure JS    |   yes | snapshot + restore | Proofs 1321–1360  |
| Installed Fastify optional param app          | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1321–1360  |
| Installed Fastify multi-route app             | Fastify   | Supported | router | text     | none       |   yes | snapshot + restore | Proofs 1321–1360  |
| Installed Fastify static cache header app     | Fastify   | Supported | simple | text     | pure JS    |   yes | snapshot + restore | Proofs 1321–1360  |
| Installed Fastify env read app                | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1361–1400  |
| Installed Fastify config JSON read app        | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1361–1400  |
| Installed Fastify feature flag env app        | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1361–1400  |
| Installed Fastify configured prefix app       | Fastify   | Supported | router | text     | none       |   yes | snapshot + restore | Proofs 1361–1400  |
| Installed Fastify health-check app            | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Proofs 1401–1420  |
| Express generic VM CJS app                    | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Next 85 candidate |
| Express generic VM ESM app                    | Express   | Supported | simple | text     | none       |    no | snapshot + restore | Next 85 candidate |
| Fastify generic VM CJS app                    | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Next 85 candidate |
| Fastify generic VM ESM app                    | Fastify   | Supported | simple | text     | none       |   yes | snapshot + restore | Next 85 candidate |

## Refused app rows

These rows are based on particular Express/Fastify refusal apps. Product behavior is **refuse before snapshot**.

| Feature / state            | Frameworks      |  Status | Evidence          |
| -------------------------- | --------------- | ------: | ----------------- |
| Active request             | Express/Fastify | Refused | Proofs 761–800    |
| Worker thread              | Express/Fastify | Refused | Proofs 761–800    |
| Native addon               | Express/Fastify | Refused | Proofs 761–800    |
| Wasm/external memory       | Express/Fastify | Refused | Proofs 761–800    |
| TLS active state           | Express/Fastify | Refused | Proofs 761–800    |
| Child process              | Express/Fastify | Refused | Proofs 761–800    |
| Filesystem watcher         | Express/Fastify | Refused | Proofs 761–800    |
| Websocket                  | Express/Fastify | Refused | Proofs 761–800    |
| DB connection              | Express/Fastify | Refused | Proofs 1001–1040  |
| Redis/queue client         | Express/Fastify | Refused | Proofs 1001–1040  |
| Live outbound HTTP socket  | Express/Fastify | Refused | Proofs 1001–1040  |
| HTTP/2 session             | Express/Fastify | Refused | Proofs 1001–1040  |
| SSE stream                 | Express/Fastify | Refused | Proofs 1001–1040  |
| Open writable file         | Express/Fastify | Refused | Proofs 1001–1040  |
| Unsafe timer/interval task | Express/Fastify | Refused | Proofs 1001–1040  |
| Cluster mode               | Express/Fastify | Refused | Proofs 1001–1040  |
| Generic VM active request  | Express/Fastify | Refused | Next 85 candidate |
| Generic VM worker thread   | Express/Fastify | Refused | Next 85 candidate |
| Generic VM native addon    | Express/Fastify | Refused | Next 85 candidate |
| Generic VM TLS active      | Express/Fastify | Refused | Next 85 candidate |
| Generic VM child process   | Express/Fastify | Refused | Next 85 candidate |

## Not-proven feature gaps

These rows are intentionally visible in the matrix as `not-proven`; they are not support claims.

| Feature gap                               | Frameworks      |     Status | Next evidence needed                                     |
| ----------------------------------------- | --------------- | ---------: | -------------------------------------------------------- |
| General external reconnect/session policy | Express/Fastify | Not proven | Reconstruction design beyond selected safe outbound rows |
| General background scheduler continuation | Express/Fastify | Not proven | Scheduler state model beyond selected idle timer rows    |

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

- Node product support: **85%**
- Broad Node product support: **25%**
- Arbitrary process cross-arch restore: **0%**
