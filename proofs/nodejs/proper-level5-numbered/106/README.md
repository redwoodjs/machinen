# Proof 106 — Real string/object/array graph recovery

## TL;DR

Recover a wider V8 graph shape with strings, arrays, objects, and references.

## Track objective

This starts broadening beyond the tiny counter/object proof. It keeps the proof local while making the recovered graph look more like everyday Node state.

## Translated continuation north star

The source heap graph is evidence. The target reconstructs native JS state from graph IR instead of copying source heap bytes.

## Tasks

- [x] Model strings, arrays, objects, and references.
- [x] Gate the graph on supported Node/V8 identity.
- [x] Refuse missing string tables and dangling references.
- [x] Reconstruct equivalent target-native state.
- [x] Keep product support out of scope.

## Proof result

`pnpm exec tsx proofs/by-id/106/smoke.ts` proves a string/object/array graph can be recovered and unsafe neighbors refuse before target start.
