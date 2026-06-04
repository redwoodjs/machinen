# 049-memory-real-promise-refusal — pending-promise

Pending Promise/microtask state refuses fail-closed.

This row uses the shared Node real-memory smoke helper to scan a real source process through `/proc/<pid>/maps` and `/proc/<pid>/mem`, produce `machinen.nodejs.memory-ir`, and retain a fail-closed refusal.

It does not claim raw V8 heap restore, raw VM replay, same PID continuation, or arbitrary Node process restore.
