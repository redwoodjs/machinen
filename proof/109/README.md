# Proof 109 — Unsupported V8 shape catalog

## TL;DR

Catalog common V8 shapes that must refuse instead of pretending broad support exists.

## Track objective

Broad support improves only when unsafe neighbors are named. This proof records typed refusals for proxy objects, weak refs, external memory, pending promise reactions, and Wasm modules.

## Translated continuation north star

Unsupported shapes stay evidence-only. They must not be materialized by copying source heap or architecture-coupled state.

## Tasks

- [x] Add an unsupported-shape catalog.
- [x] Give each row a stable refusal code and reason.
- [x] Refuse all rows before target start.
- [x] Keep product support out of scope.
