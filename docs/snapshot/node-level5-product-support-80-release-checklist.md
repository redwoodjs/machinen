# Node Level 5 80% release checklist

Before shipping the 80% Node product support tier, verify:

- Real bidirectional VM evidence exists for every supported family.
- `arm64 -> amd64` and `amd64 -> arm64` lanes pass.
- Target-native behavioral verification passes.
- Metadata-only success is refused.
- Negative real app corpus refuses workers, native addons, Wasm/external memory, TLS active state, active async in-flight work, and child process live state.
- Positive real app corpus passes Express/Fastify-style HTTP, dependency-heavy, and streams/files mixed apps.
- Repeatability runs pass with a zero flake budget.
- CI retains manifests, summaries, logs, verifier output, refusal rows, version info, and triage bundles.
- Version/ABI drift is refused for unknown Node/V8/libuv ABI.
- Broad Node product support remains partial at `20`.
- Arbitrary process cross-architecture restore remains `0`.
