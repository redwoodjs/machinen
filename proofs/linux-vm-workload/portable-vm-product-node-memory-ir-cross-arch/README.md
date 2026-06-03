# Portable VM product Node memory IR cross-arch proof

Retains product CLI evidence that selected Node Memory IR materializes through the product-owned materializer in both cross-architecture directions:

- `arm64 snapshot --portable -> amd64 restore --json`
- `amd64 snapshot --portable -> arm64 restore --json`

This proof is scoped to selected semantic Node Memory IR rows. It does not claim raw V8 heap restore, same-PID continuation, arbitrary Node process restore, arbitrary Linux process restore, or raw VM/vCPU/device replay.
