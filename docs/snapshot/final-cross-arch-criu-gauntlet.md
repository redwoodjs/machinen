# Final cross-arch CRIU checked gauntlet

The final gauntlet aggregates Goals 002-008 into one checked summary. It is a
proof ledger, not a list of product-supported features.

## Output

The checked summary is written to:

```txt
docs/snapshot/checked-summaries/cross-arch-criu/final-gauntlet.json
```

Each row includes `claimId`, classification, source/target/host architecture,
provider mode, target execution mode, state model, state decisions, verifier
command/output, artifact digests, provenance, migration status, and refusal data
when applicable.

## Classifications

- `product-supported` — a supported product path with target-native verifier
  output and artifact/provenance records. The current gauntlet has zero rows in
  this class.
- `proof-only-feasibility` — a bounded proof that demonstrates a concept without
  product support.
- `stretch-demo` — a demo-only path, such as nested virtualization.
- `refused` — a known unsafe or unsupported state that is deliberately rejected.
- `skipped` — a proof that cannot run on the current host/provider.

Refusals are part of the proof. They show that unsafe shortcuts do not silently
turn into success.

## Global invariants

The validator fails if any row reports unsupported source-ISA emulation, raw
cross-ISA CRIU image replay, sidecar output, or metadata-only continuation as a
product restore success. It also fails if a refused/skipped row has
`migrationCompleted=true`, or if a product-supported row lacks target-native
verifier output, artifact digests, or provenance.

## Reproducing

Fixture smoke:

```sh
pnpm run smoke-final-cross-arch-criu-gauntlet
```

Full checked gauntlet:

```sh
pnpm run final-cross-arch-criu-gauntlet
```

The full runner executes the component smokes for opposite-ISA execution,
stateful database restore, guest CRIU, portable snapshot + guest CRIU
composition, runtime confidence, advanced Linux facilities, and nested
virtualization, then rewrites `final-gauntlet.json`.
