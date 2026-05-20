# Runtime adapter snapshot integration

Issue #438 wires runtime adapter sidecars into the portable snapshot bundle validator.

A portable bundle may now include:

```text
runtime-adapter.json
```

When present, validation checks the runtime adapter document and cross-checks its bundle mapping:

- `bundleMapping.manifestFeatures` must exist in `manifest.features`.
- `bundleMapping.sidecarFiles` must include `runtime-adapter.json`.
- mapped portable object ids must exist in `objects.json`.
- mapped portable resource ids must exist in `resources.json`.

This keeps adapter data connected to the existing portable manifest/resources/objects documents instead of making it an unvalidated sidecar.

The portable snapshot engine remains explicit opt-in. This issue adds validation and bundle shape only; later work can make VM snapshot capture ask a guest/runtime adapter to emit the sidecar.
