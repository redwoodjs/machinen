# Portable VM product Node memory IR cross-arch proof

Retains product CLI evidence that selected semantic Node Memory IR rows materialize through the product-owned materializer in both cross-architecture directions:

- `arm64 snapshot --portable -> amd64 restore --json`
- `amd64 snapshot --portable -> arm64 restore --json`

This proof is scoped to the selected semantic row matrix: plain object, closure context, string, nested object graph, shared references, cycle, Map/Set, class instance, Buffer, TypedArray, and HTTP handler closure state. Each retained row records `detect -> capture -> decode -> classify -> materialize -> verify -> retain` evidence. It does not claim raw V8 heap restore, same-PID continuation, arbitrary Node process restore, arbitrary Linux process restore, or raw VM/vCPU/device replay.
