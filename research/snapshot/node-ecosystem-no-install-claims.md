# Audited Node ecosystem proof without third-party installs

> **Status: archived.** The old Node ecosystem runtime-profile route is no longer active smoke or product evidence. Use `pnpm run archive-node-ecosystem-restore` only with this status in mind.

Goal 37 expands third-party ecosystem realism without fetching, installing, or
executing untrusted packages. All package fixtures live under
`scripts/fixtures/node-ecosystem-registry/` and are small, audited, local source
files.

## Validated command

```bash
pnpm run archive-node-ecosystem-restore -- --keep --work-dir /tmp/machinen-node-ecosystem
```

The smoke validates both architecture directions across Node 18, 20, 22, and 24:

- remote-builder arm64 -> Proxmox amd64;
- Proxmox amd64 -> remote-builder arm64.

## Covered ecosystem classes

- transitive dependencies;
- peer dependencies;
- optional dependencies, including a missing optional dependency refusal path;
- conditional exports for ESM and CommonJS consumers;
- ESM/CJS dual-package layout;
- lifecycle-script hazard packages, refused before execution;
- native prebuild layout simulation with locally built target-native `.node`
  artifacts;
- lockfile and SBOM provenance checks;
- no-network, no-scripts, no-user-npm-config sandbox policy.

## Matrix presets

Checked summaries live in `research/snapshot/checked-summaries/node-ecosystem/`.

```bash
node scripts/portable-machine-proof-matrix.mjs \
  --preset node-ecosystem \
  --check-summary-dir research/snapshot/checked-summaries/node-ecosystem \
  --json
```

Focused presets:

- `node-ecosystem-local-registry`
- `node-ecosystem-native-prebuild`
- `node-ecosystem-lockfile-sbom`
- `node-ecosystem-sandbox`
- `node-ecosystem-app`

The suite intentionally does not run `npm install`, fetch registry packages,
execute lifecycle scripts, read user npm credentials, or reuse source-architecture
native artifacts on the target.
