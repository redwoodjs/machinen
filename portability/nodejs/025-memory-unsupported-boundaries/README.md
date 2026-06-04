# 025 — memory unsupported boundaries

Portability smoke for fail-closed memory decoder boundaries. Unsupported V8 hidden classes, sparse arrays, accessors, proxies, symbol keys, external strings, unsupported element kinds, and malformed closure snapshots produce stable refusals.

Not claimed: arbitrary Node process restore, raw V8 heap restore, same PID continuation.
