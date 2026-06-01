# Proof 110 — Cross-arch target reconstructs graph with objects, arrays, strings, and closures

## TL;DR

Materialize a wider graph IR on an amd64 Node target and prove the target reconstructs native JS state.

## Track objective

This composes the V8 state breadth work into a target-native cross-architecture reconstruction proof.

## Translated continuation north star

The target receives graph IR and rebuilds native state. It does not copy raw source heap bytes and does not emulate the source ISA.

## Tasks

- [x] Build a graph IR with string, array, object, and closure-shaped values.
- [x] Run an amd64 Node target.
- [x] Reconstruct the next target-native state.
- [x] Record raw heap copy refusal.
- [x] Keep product support out of scope.
