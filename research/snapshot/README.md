# Snapshot and move research

This directory contains proof-only material for Machinen snapshot, restore, and cross-ISA movement work.

It includes:

- checked summaries under `checked-summaries/`;
- runtime manifests under `runtime-manifests/`;
- app harness descriptors under `app-harnesses/`;
- native continuation notes, refusal catalogs, proof profiles, and historical design docs.

These files are evidence, not product documentation. User-facing product docs live in [`../../docs/`](../../docs/), and current support truth comes from:

```sh
machinen support --json
```

For cross-ISA movement, `machinen move` is the product entrypoint. Research proofs here must not be read as alternate product routes.
