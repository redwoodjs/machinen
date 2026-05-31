# Proof 058 — Native bundle assembler

## TL;DR

Build the translated-continuation bundle in native code from captured artifacts, not TypeScript glue.

## Track objective

Bundle assembly should move closer to the native verifier/materializer boundary. This proof keeps the assembler proof-local and refuses missing or non-capture-tool artifacts before target start.

## Translated continuation north star

The goal of this proof track is **translated continuation**. Capture source machine/process/runtime state, classify the stopped continuation, translate it into an architecture-neutral continuation descriptor, then materialize an equivalent target-native continuation.

## Tasks

- [x] Add a native Zig bundle assembler.
- [x] Read capture artifact files from disk.
- [x] Emit a composed translated-continuation bundle from native code.
- [x] Refuse missing or non-tool-emitted artifacts before target start.
- [x] Keep proof-only status explicit.

## Proof result

`pnpm exec tsx proof/058/smoke.ts` proves native code assembles a bundle from artifact files, the accepted bundle advances target state, and invalid artifacts refuse before target start.

## Validation

- [x] Run `pnpm exec tsx proof/058/smoke.ts`.
- [x] Assert native assembly runs before materialization.
- [x] Assert invalid artifacts refuse before target start.
