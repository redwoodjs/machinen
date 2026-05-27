# Goal 45: Productize proven `amd64 <-> arm64` snapshot/restore

Parent context: Goals 33-44 built a broad proof-and-refusal envelope showing that
selected application/runtime/service states can be moved between `amd64` and
`arm64` when they are represented as portable, target-neutral state and verified
on a target-native runtime. Those goals prove feasibility for specific fixtures
and define many unsafe-neighbor refusals, but they do not yet constitute an
implemented Machinen product path for cross-architecture snapshot/restore.

## Objective

Turn the proof-only `amd64 <-> arm64` work into an implemented, user-facing
Machinen snapshot/restore path while preserving the validity of the existing
support and refusal claims.

The goal is complete only when Machinen can take an implemented portable snapshot
through supported product surfaces, restore it on the opposite architecture, and
prove target-native continuation for the supported subsets. Unsupported or
ambiguous states must remain stable refusals with `migrationCompleted=false`.

## Guardrails

- Clearly distinguish **proof fixture**, **planned support**, and **implemented
  product support** in docs, manifests, checked summaries, and user-facing
  output.
- Do not claim arbitrary VM memory/device/CPU snapshot portability across ISAs.
  Supported cross-architecture restore is limited to explicitly modeled portable
  state with target-native reconstruction and verification.
- Do not accept source-ISA emulation, source text replay, sidecar runtime
  success, app hooks, metadata-only continuation, or host-specific byte-copy as a
  successful restore.
- Keep every unsafe neighbor refused unless it has a new explicit portable-state
  contract and target-native verifier.
- Existing proof profiles remain valid only if their fixture digests,
  provenance, refusal codes, and verification semantics still match the current
  implementation contract.

## Requirements

- [x] Inventory every existing cross-architecture proof and refusal claim from
      Goals 33-44 and classify each as one of: - proof-only fixture; - implemented product support; - explicit refusal; - obsolete or invalid claim that must be removed or corrected.
- [x] Define the implemented portable snapshot descriptor contract used by the
      product path, including versioning, provenance, architecture fields,
      runtime/service state sections, integrity digests, and refusal reasons.
- [x] Implement the product capture path for at least the first supported
      end-to-end subset, producing the portable descriptor from real Machinen
      state rather than from proof-only harness metadata.
- [x] Implement the product restore path on the opposite architecture, using
      target-native runtime/service reconstruction and target-native verification
      before `migrationCompleted=true` is reported.
- [x] Wire refusal detection into the product path for unsupported states already
      covered by the proof/refusal matrix, preserving stable refusal codes and
      `migrationCompleted=false`.
- [x] Add regression tests that fail if proof-only fixtures are accidentally
      reported as implemented product support.
- [x] Update manifests, checked summaries, matrix presets, CLI/API output, and
      docs so users can see exactly which `amd64 <-> arm64` states are
      implemented, which are only proven in fixtures, and which are refused.
- [x] Re-run the relevant proof matrices and compare their provenance/digests
      against the implemented contract so the refusing/proving work is still
      valid after productization.
- [x] If VM/rootfs/CLI/snapshot/restore behavior changes, run the full VM smoke
      suite.

## First supported implementation target

Selected subset: `postgres-clean-quiesced-logical-v1`.

The implemented product surface is a PostgreSQL logical-state bundle created by
`machinen capture postgres` and completed by
`machinen restore <bundle> --target-arch <arch> --target-verifier-output <file>`.
The positive contract covers clean/quiesced PostgreSQL logical state in both
`arm64 -> amd64` and `amd64 -> arm64` directions. The product path refuses active
transactions, active sessions, dirty WAL, host-mounted data directories,
physical data-directory/WAL byte-copy, target-architecture mismatch, logical dump
digest drift, and target verifier mismatch with `migrationCompleted=false`.

## Required final validation

Run and record timing for:

- [x] selected implemented `arm64 -> amd64` product restore smoke;
- [x] selected implemented `amd64 -> arm64` product restore smoke;
- [x] matching unsafe-neighbor product refusal smoke;
- [x] proof-vs-product claim classification test;
- [x] relevant runtime/service proof matrix for the selected subset;
- [x] full refusal matrix;
- [x] full foundation matrix audit;
- [x] full runtime support matrix if manifests change;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs` if docs/public API changed;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`;
- [x] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` if VM,
      rootfs, CLI, snapshot/restore, or live mount behavior changes.

## Completion criteria

Complete when Machinen has an implemented, user-facing, bidirectional
`amd64 <-> arm64` portable snapshot/restore path for at least one explicitly
supported subset; all existing proof/refusal claims have been audited against the
implementation contract; unsupported states remain stable refusals; and docs and
matrices accurately separate proof-only feasibility from implemented product
support.

## Completion record

Implemented Goal 45 with the PostgreSQL logical-state product subset:

- Runtime API: `packages/runtime/src/product-portable-postgres.ts`, exported from
  `@machinen/runtime`, defines the descriptor contract, integrity checks,
  product refusals, and restore summaries.
- CLI product surface: `machinen capture postgres` writes
  `portable-product.json` + `postgres.logical.dump`; `machinen restore` detects
  portable PostgreSQL bundles and writes `restore-summary.json` only after
  target verifier output passes.
- Claim inventory: `docs/snapshot/product-cross-arch-claim-inventory.json`
  classifies Goals 33-44 as proof-only fixtures, implemented product support, or
  explicit refusals. `scripts/product-portable-claim-matrix.mjs` fails if
  proof-only fixtures are reported as product support.
- Product smoke: `scripts/smoke/product-portable-postgres.sh` exercises
  `arm64 -> amd64`, `amd64 -> arm64`, and active-transaction refusal through the
  CLI product surface.
- Docs/API: `docs/snapshot/product-portable-postgres.md`,
  `docs/snapshot/proof-matrices.md`, `packages/runtime/API.md`, CLI help,
  completions, and `agent-context` document the exact implemented subset and
  distinguish product support from proof-only feasibility.
- Checked summaries:
  `docs/snapshot/checked-summaries/product-portable-postgres/`.

Final validation on 2026-05-27:

- `pnpm run smoke-product-portable-postgres` — passed in 0.425s; covered both
  directions and active-transaction refusal.
- `pnpm run product-portable-claim-matrix` — passed in 0.138s; 10 claim families,
  exactly one implemented product subset.
- `node scripts/portable-machine-proof-matrix.mjs --preset postgres-machinen --check-summary-dir docs/snapshot/checked-summaries/postgres-machinen --json --summary /tmp/goal45-postgres-machinen-matrix.json`
  — passed in 0.382s; 10/10 PostgreSQL proof/refusal profiles passed from
  checked summaries.
- `node scripts/runtime-support-matrix.mjs --json --summary /tmp/goal45-runtime-support.json`
  — passed in 0.055s.
- `node scripts/portable-machine-proof-matrix.mjs --preset refusal --summary /tmp/goal45-refusal-matrix.json --json`
  — passed in 62.752s; 1563/1563 refusal profiles passed.
- `node scripts/portable-machine-proof-matrix.mjs --preset foundation-full --summary /tmp/goal45-foundation-matrix.json --json`
  — audited in 52.399s; 2244/2245 profiles passed, with the sole failure in the
  pre-existing remote `two-thread-ppoll` target VM proof
  (`EXEC_AGENT_UNAVAILABLE` on `root@192.168.0.8`) before any Goal 45 product
  code path. Retried with `PORTABLE_AMD64_REPO=/root/machinen-node-e2e`,
  `PORTABLE_MACHINE_TARGET_VM_IMAGE=/root/machinen-node-e2e/release-assets/rootfs-debian-amd64.tar.gz`,
  and `PORTABLE_AMD64_ASSETS_DIR=/root/machinen-node-e2e/release-assets` in
  52.298s with the same pre-existing remote failure. Full local VM smoke passed
  below, covering the changed CLI restore path.
- `pnpm run format:check` — passed in 1.196s.
- `pnpm run lint` — passed in 0.196s.
- `pnpm run build:docs` — passed in 1.543s.
- `pnpm run typecheck` — passed in 2.268s.
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — passed in 52.043s; 1164
  tests passed and 12 skipped.
- `pnpm exec fallow audit --changed-since origin/main` — passed in 0.220s.
- `git diff --check` — passed in 0.018s.
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 MACHINEN_GUEST_ARCH=arm64 bash scripts/build-base-assets.sh`
  — refreshed stale local arm64 smoke assets in 74.100s.
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` — passed in
  132.763s; all smoke tests passed.
