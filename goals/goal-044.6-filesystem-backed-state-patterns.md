# Goal 44.6: Filesystem-backed state patterns

Parent: [Goal 44](./goal-044.md).

## Objective

Prove portable restore patterns for common filesystem-backed application state,
and refuse unsafe file states where flush, locking, mmap, or host ownership is
ambiguous.

## Requirements

- [ ] Add audited filesystem-state fixtures and verifiers.
- [ ] Prove append-only log restore: - fsynced append boundary; - deterministic replay verifier; - target manifest matches expected logical log state.
- [ ] Prove atomic rename/checkpoint restore: - write temp file; - fsync temp; - atomic rename; - fsync parent directory; - target verifier confirms checkpoint state.
- [ ] Prove directory manifest restore: - nested files; - content digests; - modes/ownership where supported; - target verifier output digest.
- [ ] Add stable refusals for: - mmap-backed dirty state; - advisory/mandatory lock state; - unsynced append or temp file; - partial rename boundary; - host-mounted path with ambiguous flush/ownership; - external watcher/inotify state.
- [ ] Reject source-ISA emulation, source text replay, sidecar runtime success,
      app hooks, and metadata-only continuation.

## Validation

- [ ] Append-only log restore smoke.
- [ ] Atomic rename/checkpoint restore smoke.
- [ ] Directory manifest restore smoke.
- [ ] Filesystem unsafe-neighbor refusal matrix.
- [ ] Filesystem-state proof matrix preset.
- [ ] Relevant static checks from Goal 44.

## Completion criteria

Complete when common filesystem-backed state patterns have verified clean restore
proofs and unsafe file states are stable refusals.
