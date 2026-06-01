# Proof 114 — Pending request and active request refusal matrix

## TL;DR

Only idle Node event-loop state is accepted; active or pending work refuses before target start.

## Track objective

Broad support depends on knowing when not to restore. This proof names active request, pending request, active callback, and pending microtask refusals.

## Translated continuation north star

Active continuation state cannot be copied cross-architecture. It must refuse until a later translated-continuation implementation exists.

## Tasks

- [x] Accept idle event-loop state.
- [x] Refuse active requests.
- [x] Refuse pending requests.
- [x] Refuse active callbacks and pending microtasks.
- [x] Keep product support out of scope.
