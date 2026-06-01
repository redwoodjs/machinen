# Proof 118 — Signal, stdio, env, cwd, and process metadata capture

## TL;DR

Translate basic process metadata and refuse unsafe cwd, env, and signal handler shapes.

## Track objective

Broad Node support needs process context, not just heap and sockets. This proof covers cwd, env, stdio, and signal policy evidence.

## Translated continuation north star

Process metadata is reconstructed on the target. Unsafe host-specific or code-bearing metadata refuses.

## Tasks

- [x] Capture cwd, env, stdio, and signal metadata.
- [x] Translate safe metadata into target metadata.
- [x] Refuse unsafe cwd/env entries.
- [x] Refuse custom signal handlers.
- [x] Keep product support out of scope.
