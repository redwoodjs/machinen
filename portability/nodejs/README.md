# Node.js portability corpus

This corpus is the product-facing path toward arbitrary Node portability without overclaiming raw process continuation.

`index.json` and `index.html` are generated compatibility views for the corpus. They show capability rows, per-architecture outcomes, blockers, evidence links, and claim guards.

Each numbered row lives at `portability/nodejs/NNN-<name>` and contains:

- `portability.json` — row classification, verifier contract, claim guard
- `package.json` / `app.mjs` — controlled Node fixture
- `verifier.mjs` — target-native behavior verifier

## Run modes

Classification-only, no VM boot:

```bash
pnpm node-portability-corpus --out portability/nodejs/retained/nodejs-portability-corpus-report.json
pnpm node-portability-index
```

Runtime-controlled execution on the current architecture:

```bash
pnpm node-portability-corpus --execute-vm --row 001-plain-http-create-server
```

Runtime-controlled execution on requested architectures when those hosts/assets are available:

```bash
pnpm node-portability-corpus --execute-vm --arch arm64 --arch amd64
```

Dependency-heavy rows are classified by default. Pass `--install-deps` to attempt target-native dependency installation inside the VM. Runtime failures are retained under `<report-name>-evidence/` and classified as `failed-classified` rows when the environment is available but install/start/verify fails.

## Claim boundary

This corpus does **not** claim raw Node process continuation. It shows that arbitrary Node rows can be inventoried, classified, run/refused through Machinen runtime, and guarded by stable claim language. Refused-first rows stay product-refusal evidence until their target-native reconstruction path has retained portability smokes.

## Memory-only scalar smoke

`021-memory-scalar-counter` retains a narrower smoke than the app corpus: one controlled memory-only Node `count` scalar is captured from source process memory and reconstructed target-native across `arm64 -> amd64`.

Rows `022` through `035` move existing V8/Node memory-state coverage into portability smokes for selected plain objects, packed arrays, closure contexts, strings, nested/shared/cyclic object graphs, Map/Set, class instances, HTTP handler closure state, Buffer, typed arrays, and fail-closed unsupported async/runtime boundaries.

Row `036-memory-capture-classifier` starts a real Node process inside a guest and captures `/proc/<pid>/maps` plus `/proc/<pid>/mem` to classify seeded Node/V8 memory categories on both `arm64` and `amd64`.

Row `037-memory-real-plain-object` retains an `arm64 -> amd64` source-memory capture and target-native materialization proof for one selected plain-object state. It is semantic state portability, not raw V8 heap restore, raw VM replay, or arbitrary process continuation.

These rows do not lift the broad arbitrary Node heap/process claim; they add scoped compatibility dimensions. Run the local decoder smokes with:

```bash
pnpm node-portability-memory-state-smokes
```
