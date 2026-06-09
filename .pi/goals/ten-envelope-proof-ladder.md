# Ten-envelope proof ladder

## Goal

Adjust the next `machinen move` roadmap so the next envelope batch has at least ten proofs. Each proof must either support a named narrow envelope or gatekeep a nearby unsafe shape with a fail-closed refusal. Do not claim generic process, runtime, or VM restore.

## Proof ladder

| Status | Proof  | Role                 | Envelope                      | Required evidence                                                                                         |
| ------ | ------ | -------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| ☑      | 6A-P1  | Support              | `tail -f file                 | grep --line-buffered pattern`                                                                             | Roadmap row added: rebuild two-process pipe and emit only matching appended lines. |
| ☑      | 6B-P2  | Gatekeeper           | unsupported pipe graph        | Roadmap row added: refuse fanout, extra filters, bidirectional pipes, and unknown endpoints.              |
| ☑      | 6C-P3  | Support              | `dd if=file of=file bs=N`     | Roadmap row added: continue captured read/write offsets.                                                  |
| ☑      | 6D-P4  | Gatekeeper           | unsafe `dd` mutation          | Roadmap row added: refuse append, sparse/device outputs, truncation ambiguity, unsupported `conv`.        |
| ☑      | 6E-P5  | Support              | `find DIR -type f -print`     | Roadmap row added: resume deterministic traversal after last emitted path.                                |
| ☑      | 6F-P6  | Gatekeeper           | complex `find` traversal      | Roadmap row added: refuse `-exec`, symlink-following, changing trees, and complex predicates.             |
| ☑      | 6G-P7  | Support              | `tar -cf archive DIR`         | Roadmap row added: produce a validating archive with each file once.                                      |
| ☑      | 6H-P8  | Gatekeeper           | unsafe `tar` archive          | Roadmap row added: refuse compression, pipes, remotes, source mutation, and multi-volume archives.        |
| ☑      | 6I-P9  | Support + gatekeeper | hardened Python HTTP server   | Roadmap row added: prove idle listener; refuse active request, port conflict, missing cwd/file, mismatch. |
| ☑      | 7A-P10 | Support              | `node server.mjs` static HTTP | Roadmap row added: first Node support proof only after Phase 6 primitives.                                |
| ☑      | 7B-P11 | Gatekeeper           | unsupported Node service      | Roadmap row added: refuse workers, child processes, native addons, active requests, heap-only state.      |

## Evidence

- `GOAL.md` now includes Phase 6/7 rows in the phase plan.
- `GOAL.md` now includes a dedicated "Phase 6/7 — proof ladder before broad runtime claims" section with eleven proof rows.
- Node is included as the first runtime envelope only after pipe, mutating-file, traversal/archive, and listener-hardening proofs.
- Proof-only packages remain proof-provisioned or overlay-provisioned, not baked into the base image.

## Status

COMPLETE
