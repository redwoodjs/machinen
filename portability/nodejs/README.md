# Node.js portability corpus

This corpus is the product-facing path toward arbitrary Node portability without overclaiming raw process continuation.

Each numbered row lives at `portability/nodejs/NNN-<name>` and contains:

- `portability.json` — row classification, verifier contract, claim guard
- `package.json` / `app.mjs` — controlled Node fixture
- `verifier.mjs` — target-native behavior verifier

## Run modes

Classification-only, no VM boot:

```bash
pnpm node-portability-corpus --out portability/nodejs/retained/nodejs-portability-corpus-report.json
```

Runtime-controlled execution on the current architecture:

```bash
pnpm node-portability-corpus --execute-vm --row 001-plain-http-create-server
```

Runtime-controlled execution on requested architectures when those hosts/assets are available:

```bash
pnpm node-portability-corpus --execute-vm --arch arm64 --arch amd64
```

Dependency-heavy rows are classified by default. Pass `--install-deps` to attempt target-native dependency installation inside the VM.

## Claim boundary

This corpus does **not** claim raw Node process continuation. It proves that arbitrary Node rows can be inventoried, classified, run/refused through Machinen runtime, and guarded by stable claim language. Refused-first rows stay product-refusal evidence until their target-native reconstruction path has retained proofs.
