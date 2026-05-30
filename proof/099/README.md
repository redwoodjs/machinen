# Proof 099 — Native build-gated V8 object decoder emits graph IR

## TL;DR

Move the tiny build-gated V8 object recovery path into a native decoder that emits graph IR.

## Track objective

This reduces TypeScript harness logic in V8 recovery. The native decoder enforces build, encoding, and map gates before producing graph IR.

## Translated continuation north star

Captured V8 object evidence is translated into graph IR. The target reconstructs native JS state; it does not copy source heap bytes.

## Tasks

- [x] Add a native V8 object decoder skeleton.
- [x] Enforce Node/V8 build and encoding gates.
- [x] Enforce supported object map gates.
- [x] Emit graph IR for the tiny supported object subset.
- [x] Refuse unsupported records before target start.

## Proof result

`pnpm exec tsx proof/099/smoke.ts` proves native decoding emits graph IR for the supported record and refuses unsupported build, encoding, and map variants.

## Validation

- [x] Run `pnpm exec tsx proof/099/smoke.ts`.
- [x] Assert native graph IR emission.
- [x] Assert unsupported records refuse before target start.
