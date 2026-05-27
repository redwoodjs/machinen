# Goal 41.4: Refusal UX, docs, and upgrade path

Parent: [Goal 41](./goal-041.md).

## Objective

Make hard runtime-state refusals understandable and actionable for users, while
recording exactly what future proof is required to graduate each refusal into
support.

## Requirements

- [ ] Publish a stable refusal catalog for Goal 40/41 states with: - code; - short message; - detailed explanation; - affected runtimes; - current behavior; - remediation; - graduation requirements.
- [ ] Add user-facing guidance for common outcomes: - close or drain sockets before snapshot; - configure reconnect-after-restore; - avoid opaque native extension state; - provide explicit native external-state contracts; - quiesce Go goroutines and channel waiters; - avoid cgo for portable Go restore.
- [ ] Ensure proof summaries expose enough data for CLI/API surfaces to show the
      refusal reason without parsing ad-hoc text.
- [ ] Ensure docs distinguish stable refusals from backlog/support promises.
- [ ] Link the catalog from support-envelope and proof-matrix documentation.
- [ ] Add tests or matrix assertions that refusal UX metadata is present for each
      Goal 41 code.

## Completion criteria

Complete when users can see why each hard runtime state was refused, what they
can do today, and exactly what proof would be required before Machinen could
claim support.
