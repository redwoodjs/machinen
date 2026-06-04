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

This corpus does **not** claim raw Node process continuation. It shows that arbitrary Node rows can be inventoried, classified, run/refused through Machinen runtime, and guarded by stable claim language. Refused-first rows stay product-refusal evidence until their target-native reconstruction path has retained portability smokes. The current generated matrix is 174 verified / 138 verified-refusal / 0 unverified-refused. Rows move out of unverified refused only when they either have retained fail-closed proof or retained Node Resource IR product smokes proving semantic target-native reconstruction with a VMM-native pause marker; unsafe raw/live/native continuation remains verified-refusal, not supported.

## Memory-only scalar smoke

`021-memory-scalar-counter` retains a narrower smoke than the app corpus: one controlled memory-only Node `count` scalar is captured from source process memory and reconstructed target-native across `arm64 -> amd64`.

Rows `022` through `035` move existing V8/Node memory-state coverage into portability smokes for selected plain objects, packed arrays, closure contexts, strings, nested/shared/cyclic object graphs, Map/Set, class instances, HTTP handler closure state, Buffer, typed arrays, and fail-closed unsupported async/runtime boundaries.

Row `036-memory-capture-classifier` starts a real Node process inside a guest and captures `/proc/<pid>/maps` plus `/proc/<pid>/mem` to classify seeded Node/V8 memory categories on both `arm64` and `amd64`.

Rows `037` through `048` retain bidirectional real-memory evidence (`arm64 -> amd64` and `amd64 -> arm64`) for selected plain object, array, closure context, string, nested/shared/cyclic graphs, Map/Set, class instance, Buffer, typed array, and HTTP handler closure state. Rows `050` through `059` extend that matrix to Date/RegExp, Error objects, URL/URLSearchParams, BigInt-rich graphs represented as tagged semantic values, module-level singleton state, ArrayBuffer/DataView, Symbol-keyed object descriptors, EventEmitter listener registry metadata, in-memory LRU cache state, and queue state. Each supported row captures `/proc/<pid>/maps` and `/proc/<pid>/mem`, emits `machinen.nodejs.memory-ir`, materializes that semantic IR in target-native Node, and verifies behavior.

Rows `063` through `312` add the next 50 declared compatibility batches: 108 reconstructable semantic rows are now product-supported through Node Memory IR materialization in both `arm64 -> amd64` and `amd64 -> arm64` product smokes, while unsafe live/native/opaque rows stay fail-closed with stable refusal codes until they have a real reconstruction path.

Product portable VM snapshots can carry `nodejs-memory-ir.json` / `nodejs-memory-classification.json` for passive semantic memory rows and `nodejs-resource-ir.json` / `nodejs-resource-inventory.json` / `nodejs-resource-classification.json` for reconstructable runtime resource specs. Resource IR rows require a paused source-VM capture boundary; the product portable snapshot path retains `portable-vm-pause-boundary.json` after the VMM writes a native `SIGUSR1`/`SIGUSR2` pause marker, then restore plans use `materialize-nodejs-memory-ir-target-native` and `materialize-nodejs-resource-ir-target-native`; unsupported paused live/native/opaque resources fail closed under `workloads.nodejs.resourceRefusals[]` instead of being treated as Memory IR.

These rows do not lift the broad arbitrary Node heap/process claim; they add scoped compatibility dimensions. Run the local decoder smokes with:

```bash
pnpm node-portability-memory-state-smokes
pnpm node-portability-real-memory-smokes
```
