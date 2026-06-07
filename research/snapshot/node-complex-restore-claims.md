# Complex Node restore claims

> **Status: archived.** The old complex Node runtime-profile route is no longer active smoke or product evidence. Use `pnpm run archive-node-complex-restore` only with this status in mind.

Goal 36 expands the Node portable restore proof from bounded proof apps to a more
complex real-world application suite. The validated command is:

```bash
pnpm run archive-node-complex-restore -- --keep --work-dir /tmp/machinen-node-complex
```

The smoke validates both architecture directions for Node 18, 20, 22, and 24:

- remote-builder arm64 -> Proxmox amd64;
- Proxmox amd64 -> remote-builder arm64.

## Covered complexity

- framework-shaped API and server-rendering apps with middleware, routing,
  static assets, warm route tables, and production start behavior;
- SQLite WAL and Redis persistence support, plus Postgres/open transaction and
  ambiguous durability refusals;
- WebSocket-equivalent upgrade traffic, TLS reconnect policy with certificate
  provenance, and HTTP keep-alive verification;
- Node cluster/worker/supervisor-equivalent process topology with leak/orphan
  audit;
- published-native-package layout coverage for database/image/crypto-style native
  packages using target-native N-API artifacts and ABI provenance;
- concurrent-load and failure-injection policy with repeatability assertions;
- OS/runtime matrix records Node, V8, libuv, OpenSSL, modules ABI, N-API, libc,
  distro, and bidirectional route constraints.

## Matrix presets

Checked summaries live in `research/snapshot/checked-summaries/node-complex/`.

```bash
node scripts/portable-machine-proof-matrix.mjs \
  --preset node-complex \
  --check-summary-dir research/snapshot/checked-summaries/node-complex \
  --json
```

Focused presets:

- `node-complex-frameworks`
- `node-complex-persistence`
- `node-complex-networking`
- `node-complex-topology`
- `node-complex-native`
- `node-complex-load-failure`
- `node-complex-os-runtime`

Unsupported neighboring states continue to fail closed with stable refusal codes
and `migrationCompleted=false`.
