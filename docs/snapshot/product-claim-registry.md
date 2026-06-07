# Product claim registry

The product claim registry reports the current support status for snapshot,
restore, and cross-ISA movement claims.

## Current status

- `implemented-product-support`: currently no cross-ISA legacy Level 0-4 row is implemented product support.
- `deprecated-legacy-support`: former Level 1/4 cross-ISA support rows are retained as deprecated evidence only. They have `migrationCompleted=false`, `proofOnly=true`, `supportLevel="deprecated-cross-isa-level"`, and `productRefusalCode="deprecated-cross-isa-level"`.
- `stable-product-refusal`: unsafe or unproven states are product-visible refusals with stable refusal evidence.
- `proof-only-fixture`: proof harness evidence that is not product support.

## Current cross-ISA rule

`machinen move` is the only cross-ISA product entrypoint. The registry must not
advertise old numbered Level 0-4 routes as positive support.

## CLI discovery

```sh
machinen support --json
machinen support --status deprecated-legacy-support --json
machinen support --status stable-product-refusal --json
machinen support --status proof-only-fixture --json
```

`--json` returns matching entries with:

- `productStatus`;
- `family`;
- `runtime` / `resourceFamily` when known;
- `architectureRoutes`;
- `refusalCode` and `productRefusalCode`;
- `migrationCompleted`;
- `proofOnly`;
- `supportLevel` and `supportLevelName`;
- `observableStateDecisions`;
- `graduationRequirements`.

## Validation

Use:

```sh
pnpm run product-claim-registry-matrix
pnpm run smoke-product-support-discovery
```
