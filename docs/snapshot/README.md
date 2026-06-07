# Snapshot documentation status

This directory contains product docs, proof/audit records, and archived research
notes. Treat this page as the entry point before relying on any older snapshot
claim.

## Current product-facing snapshot support

Product support is whatever is visible through the public product surface and the
product claim registry, not whatever a proof harness once completed.

Use:

```sh
pnpm run smoke-product-support-discovery
machinen support --json
```

Current product-facing families are documented in:

- [Product claim registry](./product-claim-registry.md)
- [Cross-ISA support levels](./cross-isa-support-levels.md)
- [Clean service product snapshot/restore](./clean-service-product-snapshot-restore.md)
- [Node product snapshot/restore](./node-product-snapshot-restore.md)
- [Level 4 ping machine workload](./level4-ping-machine-workload.md)
- [Level 4 eventfd portable restore](./level4-eventfd-portable-restore.md)
- [Level 4 pipe portable restore](./level4-pipe-portable-restore.md)
- [Level 4 timerfd portable restore](./level4-timerfd-portable-restore.md)
- [Level 4 TCP listener portable restore](./level4-tcp-listener-portable-restore.md)
- [Product portable PostgreSQL](./product-portable-postgres.md)

## Level 5 direction

Level 5 is still the desired direction, but product Level 5 must be based on
captured source machine/process state and target-native reconstruction of that
state. Runtime-profile routes, selected-state descriptors, app-exported state,
source-text replay, sidecars, source-ISA emulation, and metadata-only success are
not acceptable product paths.

Read first:

- [Level 5 product roadmap](./level5-product-roadmap.md)
- [Native/process-continuation audit](./native-process-continuation-audit.md)
- [Architecture-portable snapshot gauntlet](./architecture-portable-snapshot-gauntlet.md)

Historical runtime-profile docs remain for context only:

- [Level 5 runtime adapter substrate](./level5-runtime-adapter-substrate.md)
- [Node Level 5 HTTP profile](./node-level5-http-profile.md)
- [Node Level 5 proof composition](./node-level5-proof-composition.md)

## Proof/audit records

Proof docs are useful for design and regression guardrails, but do not imply
product support unless the product claim registry says so. Their package scripts
now use `proof-*` names.

Examples:

- [Runtime confidence profiles](./runtime-confidence-profiles.md)
- [Advanced Linux facility probes](./advanced-linux-facility-probes.md)
- [Nested virtualization stretch proof](./nested-virtualization-stretch-proof.md)
- [Guest checkpoint substrate](./guest-checkpoint-substrate.md)
- [Stateful services restore claims](./stateful-services-restore-claims.md)
- [PostgreSQL Machinen restore claims](./postgres-machinen-restore-claims.md)

## Archived research notes

Archived docs describe stale runtime-profile or app-level restore claims. The old
scripts are exposed only through `archive-*` aliases that fail by default. Keep
these docs for archaeology, not for product/support evidence.

Archived areas include:

- Node live/production/expanded/complex/ecosystem runtime-profile restore claims;
- non-Node cross-architecture runtime-profile restore claims;
- Go quiescent runtime restore claims;
- older portable cross-ISA C proof harnesses.
