# Real Node.js/PostgreSQL/Redis continuation ladder

This ladder pushes native continuation research into real application runtimes
while preserving refusal boundaries.

It uses target-native Docker images only as provisioning for real `node`,
`postgres`, and `redis` binaries on amd64 and arm64 hosts. The retained claim is
architecture-neutral descriptor/resource reconstruction. It does **not** claim
JavaScript heap restore, PostgreSQL or Redis process memory restore, raw
stack/register restore, kernel socket identity preservation, source-ISA
emulation, or arbitrary process restore.

Supported rows:

- `node-http-idle-listener`
- `node-parked-workers`
- `node-repl-prompt`
- `node-http-keepalive-idle`
- `postgres-idle-listener`
- `postgres-idle-client-backend`
- `redis-idle-listener`
- `redis-idle-client`

Retained refusals:

- `node-queued-http-body`
- `node-active-worker`
- `node-streaming-response-inflight`
- `postgres-active-query`
- `postgres-active-transaction`
- `postgres-lock-wait`
- `redis-queued-command`

Run:

```sh
portability/research/real-node-postgres-continuation-ladder/verify.sh
```

Retained output: `retained/report.json`.
