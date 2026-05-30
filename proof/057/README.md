# Proof 057 — Native verifier reads structured bundle format

## TL;DR

Replace string-search verification with a native Zig verifier that parses the bundle as structured JSON.

## Track objective

The verifier should understand the bundle shape before deciding whether target materialization is allowed. This proof remains proof-only and refuses malformed or unsafe bundles before target start.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation. Source registers, stacks, PCs, heap bytes, and kernel resources are evidence for translation; they are not raw bytes to copy into the target, especially across architectures.

## Tasks

- [x] Add a Zig verifier that parses JSON into typed bundle structs.
- [x] Validate schema version, architecture, continuation class, resources, refusal policy, and digest flags.
- [x] Refuse product claims and forbidden shortcut flags before target start.
- [x] Emit stable refusal codes for malformed or unsafe bundles.

## Proof result

`pnpm exec tsx proof/057/smoke.ts` proves the native verifier parses structured JSON, accepts the valid bundle, and refuses malformed JSON, bad schema, bad architecture, bad continuation, digest failure, product claims, and shortcut flags before target start.

## Validation

- [x] Run `pnpm exec tsx proof/057/smoke.ts`.
- [x] Assert the verifier uses structured JSON parsing.
- [x] Assert invalid bundles refuse before target start.
- [x] Assert no product support claim is made.
