# Node Level 5 product snapshot/restore surface

Node Level 5 support now uses the product-shaped surface first:

```sh
machinen snapshot <vm-name> \
  --out ./node-snapshot

machinen restore ./node-snapshot
```

This path does not require an experimental Node Level 5 flag or a Node-only snapshot selector. `snapshot <vm-name>` resolves a registered Machinen VM name, snapshots the whole VM, and detects supported Node workloads inside that VM for retained Node Level 5 evidence. Host PID targeting is not the public product path; PID-based proof harnesses are diagnostic-only and must not be described as product support.

The VM snapshot bundle is restored with `machinen restore <dir>`. Node Level 5 release evidence is retained and checked by the support-matrix/release-gate tooling for selected app rows. Proof corpus fixtures can provide `machinen-node-level5-behavior.json` to launch a real app entry and retain route, status, body, and header evidence. Release checks can retain those rows in `node-level5-real-app-corpus-report.json` and include the report with `machinen node-level5 release-gate --include-real-app-corpus --corpus-report <file>`. The product-run corpus generator in `scripts/node-level5-real-app-product-run-corpus.ts` keeps proof-local host-PID plumbing behind `MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT=1`; that path exists only to produce release evidence for selected app rows. The refusal corpus generator in `scripts/node-level5-real-app-refusal-corpus.ts` keeps the other side of the boundary: unsupported Express/Fastify states must refuse before snapshot and can be included with `machinen node-level5 release-gate --include-refusal-corpus --refusal-corpus-report <file>`. The third-party app corpus generator in `scripts/node-level5-third-party-app-corpus.ts` adds declared-subset Express/Fastify app templates and can be included with `machinen node-level5 release-gate --include-third-party-app-corpus --third-party-app-corpus-report <file>`. The installed third-party app corpus generator in `scripts/node-level5-installed-third-party-app-corpus.ts` adds selected real installed `express`, `fastify`, and `@fastify/sensible` package examples and can be included with `machinen node-level5 release-gate --include-installed-third-party-app-corpus --installed-third-party-app-corpus-report <file>`. The app-based support matrix in `research/snapshot/node-level5-app-support-matrix.md` lists the particular supported and refused app rows and is available as `machinen node-level5 support-matrix --json`. These reports keep the boundary clear: no raw CPU restore, source ISA emulation, or metadata-only success. The path still keeps the support boundary narrow:

- Node product support: 80%.
- Broad Node product support: 20%.
- Arbitrary process cross-architecture restore: 0%.
- Raw CPU restore: not supported.
- Source ISA emulation: not supported.

The diagnostic `machinen node-level5 ...` commands remain useful for release gates and support triage, but they are no longer the primary product shape. The product direction is snapshot first, restore second, with retained detector evidence and artifact evidence checked behind the scenes.
