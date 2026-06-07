# Node Level 5 50% release checklist

Before shipping the 50% Node product support tier, verify:

- Product contracts for all eleven families are current.
- Real guarded E2E lanes pass for the six new families.
- Bidirectional `arm64 -> amd64` and `amd64 -> arm64` lanes pass across all families.
- Target-native verification passes and metadata-only success is refused.
- Repeatability lanes pass.
- Artifact diff stability passes.
- CI retains manifests, summaries, logs, refusal rows, and version info.
- Public docs and compatibility matrix mention the 50% scope.
- Version policy pins Node `22.x`, V8 `12.x pointer-compressed`, and supported idle libuv handles.
- Security audit confirms no raw CPU restore, no source ISA emulation, and no app checkpoint hooks.
- Product claim audit keeps broad Node product support at `0`.
