# Goal 31: Guardrail and validate Node real app smoke suite

Parent context: Goal 30 added representative `runtime:node:app:*` profiles and
app harnesses. This goal hardens that suite so Node app profiles cannot pass via
metadata-only, synthetic, sidecar, source text replay, app-hook, or source-ISA
emulation shortcuts.

## Objective

Validate and guardrail the Node real app smoke suite. Completion means every Node
app smoke profile has a real fixture, app harness, target output verifier,
checked summary path, and matrix coverage, and tests fail if any Node app tries to
pass without those requirements.

## Requirements

- [x] Every Node app profile uses a `real-node-app:` source fixture.
- [x] Every Node app profile has a real tracked fixture file.
- [x] Every Node app profile has an app harness JSON file.
- [x] Every Node app profile has a target output verifier.
- [x] Every Node app profile has a checked summary path.
- [x] Every Node app profile requires the `node-app-output` gate.
- [x] No Node app profile uses synthetic shortcut fields.
- [x] Node app summaries keep `sourceIsaEmulationUsed=false`.
- [x] Node app summaries keep `sourceTextReusedAsTargetCode=false`.
- [x] Node app summaries keep `sidecarRuntimeUsed=false`.
- [x] Node app summaries keep `appHooksRequired=false`.
- [x] Node app matrices cover all ten workloads.
- [x] Tests fail if fixtures, harnesses, checked summaries, output verifiers, or
      matrix coverage are missing.

## Implemented guardrails

- Added real Node app fixture files under `scripts/fixtures/node-apps/*/app.mjs`.
- Converted the 10 Node app profiles from metadata-only live-capture fixtures to
  `real-node-app:` fixtures.
- Added `targetOutputVerifier`, `appHarness`, `realFixture`, and `checkedSummary`
  fields to every Node app profile.
- Added checked summaries under `docs/snapshot/checked-summaries/node-apps/`.
- Added the `node-app-output` proof gate.
- Added real Node app execution in `scripts/portable-machine-proof-runner.mjs` so
  the app profile runs the tracked fixture and verifies stdout contains the
  expected target output.
- Added schema guardrails that reject Node app profiles with missing real
  fixtures, missing harnesses, missing checked summaries, missing output
  verifiers, missing `node-app-output` gate, or synthetic shortcut fields.
- Added matrix aliases and individual workload presets:
  - `node-real-apps`;
  - `node-real-apps-positive`;
  - `node-real-cli`;
  - `node-real-cjs`;
  - `node-real-esm`;
  - `node-real-timers-async`;
  - `node-real-fs-stdio`;
  - `node-real-http-tcp`;
  - `node-real-udp-dns`;
  - `node-real-worker`;
  - `node-real-native-addon`;
  - `node-real-crypto-tls`.
- Added focused test coverage in
  `packages/runtime/src/__tests__/portable-machine-proof-runner.test.ts` for the
  real Node app guardrails.
- Updated support envelope and proof matrix/profile docs.

## Validation record

- proof profile schema validation — passed after guardrail implementation;
- `node-real-apps-positive` matrix — 0.890s, 10/10 profiles passed;
- `node-real-apps` matrix — 0.984s, 10/10 profiles passed;
- individual workload matrices — CLI 0.142s, CJS 0.144s, ESM 0.141s,
  timers/async 0.143s, fs/stdio 0.143s, HTTP/TCP 0.146s, UDP/DNS 0.143s, worker
  0.142s, native addon 0.144s, crypto/TLS 0.145s;
- checked-summary `node-real-apps` matrix — 0.492s, 10/10 cached summaries
  passed;
- focused proof runner/runtime-support tests — 5.114s, 85 tests passed;
- full Node matrix — 13.513s, 281/281 profiles passed;
- full refusal matrix — 74.745s, 1484/1484 profiles passed;
- foundation matrix with checked summaries — 80.706s, 2121/2121 profiles passed.

Artifact hashes:

- proof runner sha256:
  `ead5398b571805840e1aa6d87710477d8349f215cee6f932323756d75d5870c0`;
- proof matrix sha256:
  `1638e3d703685677f382604320400f6f5de5c05eaceaff49b741cbc32bb7d3a7`;
- proof profile inventory sha256:
  `91205ccb77e674491fac3c7b755e27b4744afe72ea1b3e3a09214bb74210293a`;
- positive descriptor fixture registry sha256:
  `7d61f099b0141f2673df96f3676dfed59b93c3adc9000cef4b84030c2ef597e4`;
- live source-capture fixture registry sha256:
  `186b8a3a82073e2466d62451b25dbdb294951d4f8b3e70cb7e11957e94a22d53`;
- Node application support harness sha256:
  `fb17651abe49caa40248539ae8335d5e304094cc31ac00efca0657ced4044f1d`.

Final static validation:

- final proof profile schema validation — 0.074s;
- final runtime support matrix validation — 0.040s;
- final `pnpm run format:check` — 1.384s;
- final `pnpm run lint` — 0.357s;
- final `pnpm run build:docs` — 2.001s;
- final `pnpm run typecheck` — 2.978s;
- final `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.747s;
- final `pnpm exec fallow audit --changed-since origin/main` — 0.414s;
- final `git diff --check` — 0.057s.

## Completion criteria

Goal 31 is complete only when all Node app smoke profiles are guarded against
metadata-only/synthetic shortcuts, all ten workloads have real fixtures,
harnesses, checked summaries, target output verifiers, and matrix coverage, tests
fail for missing/forbidden Node app paths, and final validation passes.
