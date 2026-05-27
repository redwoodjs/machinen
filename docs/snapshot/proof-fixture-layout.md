# Proof fixture layout

Machinen separates production guest assets from proof-only fixtures.

## Production assets

`packages/microvm/assets/` is reserved for files that build or ship with
Machinen VM/base assets, such as:

- `/init` and `/exec-agent` sources;
- snapshot/restore shell helpers;
- guest networking and utility agents;
- kernel/device-tree inputs.

These files are tracked by `scripts/check-asset-freshness.sh` and may affect
`release-assets/` or the guest rootfs.

## Proof-only assets

`packages/microvm/test-fixtures/proof-assets/` contains portable-restore proof
fixtures, native test targets, runtime harnesses, and continuation/capture
fixtures. These files are compiled or copied only by proof scripts and tests.
They are not production guest payloads.

Service/runtime fixtures that are not microVM-specific live under
`scripts/fixtures/`, for example:

- `scripts/fixtures/stateful-services/`;
- `scripts/fixtures/node-ecosystem-registry/`;
- descriptor fixture registries used by proof matrices.

## Rule of thumb

If a file is required for every normal Machinen VM boot or release asset build,
it belongs in `packages/microvm/assets/`. If it exists to prove, refuse, or test a
specific restore behavior, it belongs in a fixture directory.
