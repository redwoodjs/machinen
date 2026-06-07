# Product claim registry

The product claim registry is the source of truth for snapshot, restore, and move support.

## Product rule

`machinen move` is the only cross-ISA product entrypoint. Older cross-ISA routes are not product support.

## Statuses

- `implemented-product-support`: supported product behavior.
- `stable-product-refusal`: product-visible refusal for unsafe or unproven state.
- `deprecated-legacy-support`: removed legacy cross-ISA behavior retained only as refusal evidence.
- `proof-only-fixture`: research evidence, not product support.

## CLI discovery

```sh
machinen support --json
machinen support --status implemented-product-support --json
machinen support --status stable-product-refusal --json
machinen support --status deprecated-legacy-support --json
machinen support --status proof-only-fixture --json
```

`--json` returns matching entries with status, family, route, refusal, migration, and support metadata.

## Validation

Use:

```sh
pnpm run product-claim-registry-matrix
pnpm run smoke-product-support-discovery
```
