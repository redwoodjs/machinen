# Proof 120 — Negative gauntlet for unsafe threads, active requests, and unknown fds

## TL;DR

Compose the process safety refusals into one negative gauntlet.

## Track objective

Broad support needs a reliable stop sign for unsafe process state. This proof refuses running threads, active requests, unknown fds, and source-fd copying.

## Translated continuation north star

Unsafe source state is not target material. The path refuses before target start instead of faking success.

## Tasks

- [x] Refuse unsafe threads.
- [x] Refuse active requests.
- [x] Refuse unknown fds/resources.
- [x] Refuse source-fd copying.
- [x] Keep product support out of scope.
