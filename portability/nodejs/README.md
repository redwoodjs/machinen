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

`021-memory-scalar-counter` retains a narrower smoke than the app corpus: one controlled memory-only Node `count` scalar is captured from source process memory and reconstructed target-native across `arm64 -> amd64`. This does not lift the broad arbitrary Node heap/process claim; it adds one scoped compatibility dimension.
