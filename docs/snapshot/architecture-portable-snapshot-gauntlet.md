# Architecture-portable snapshot checked gauntlet

The final gauntlet aggregates the architecture-portable snapshot proof rows into
one checked summary. It is a proof ledger, not a list of support
features.

## Output

The checked summary is written to:

```txt
docs/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json
```

Each row includes `claimId`, `evidenceStatus`, source/target/host architecture,
provider mode, target execution mode, `evidenceCategory`, `productSupport`,
`implementationLevel`, `graduationTargetLevel`, state model, state decisions,
verifier command/output, artifact digests, provenance, migration status, and
refusal data when applicable.

## Evidence statuses

- `support` — a supported product path with target-native verifier
  output and artifact/provenance records. The current gauntlet has zero rows in
  this class.
- `proof` — a bounded proof that demonstrates a concept without
  product support.
- `stretch-demo` — a demo-only path, such as nested virtualization.
- `refusal` — a known unsafe or unsupported state that is deliberately rejected.
- `skipped` — a proof that cannot run on the current host/provider.

Refusals are part of the proof. They show that unsafe shortcuts do not silently
turn into success.

## Evidence/support/level invariants

The gauntlet keeps theory separate from product behavior:

- `supported-semantic-restart`
- `supported-semantic-continuation`
- `runtime-aware-proof`
- `native/process-proof`
- `unsupported`

`evidenceStatus` says whether a row is proof, refusal, product support evidence,
or skipped. `productSupport` says what users can rely on: `supported`,
`not-yet-supported`, or `unsupported`. `implementationLevel` is the actual
supported implementation level, while `graduationTargetLevel` is the level the
proof or refusal is about.

`migrationCompleted=true` only means that row's verifier passed. It does not
imply product support unless `evidenceStatus=support`,
`productSupport=supported`, `implementationLevel` names the supported level, and
the row is routed through the public product surface.

## Native/process phase-2 rows

The checked gauntlet promotes existing native/process evidence into proof and
refusal rows:

- register translation;
- stack/return-chain translation;
- private memory translation/materialization;
- executable/target module materialization;
- target restore loader materialization;
- TLS/rseq/SIMD/FPU policy refusals;
- signal policy refusals;
- active syscall policy refusals;
- thread restore policy refusals;
- mapping refusals;
- resource refusals.

Positive native/process rows remain `evidenceStatus=proof`,
`evidenceCategory=native/process-proof`, `productSupport=not-yet-supported`, and
`implementationLevel=not-implemented` because they are not routed through public
`machinen snapshot` / `machinen restore` verbs. Their
`graduationTargetLevel=level-5-cross-arch-process-continuation`. Refusal rows
remain `evidenceStatus=refusal`, `evidenceCategory=unsupported`,
`productSupport=unsupported`, `implementationLevel=level-0-fail-closed-discovery`,
and `migrationCompleted=false`.

## Global invariants

The validator fails if any supported product row reports unsupported source-ISA
emulation, raw cross-ISA checkpoint replay, sidecar output, or metadata-only
continuation as a product restore success. It also fails if a refusal/skipped row
has `migrationCompleted=true`, if a refusal row is not `productSupport=unsupported`,
if a native/process proof row changes to supported product support, if a completed
non-product row omits an explicit product-support disclaimer, or if a support row
lacks target-native verifier output, artifact digests, or provenance.

## Reproducing

Fixture smoke:

```sh
pnpm run smoke-architecture-portable-snapshot-gauntlet
```

Full checked gauntlet:

```sh
pnpm run architecture-portable-snapshot-gauntlet
```

The full runner executes the component smokes for opposite-ISA execution,
guest checkpoint, portable snapshot + guest checkpoint composition, advanced
Linux facilities, nested virtualization, and native/process proof/refusal
scripts, then rewrites `final-gauntlet.json`.

The audit in `docs/snapshot/architecture-portable-proof-audit.md` removed the
fixture-only stateful database restore and runtime confidence rows from this
ledger. They were contract fixtures, not evidence for Machinen-owned portable
snapshot or process-continuation behavior.
