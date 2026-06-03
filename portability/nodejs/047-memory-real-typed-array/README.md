# 047-memory-real-typed-array — typed-array

Selected typed-array contents captured from source process memory and materialized target-native across architectures.

This row uses the shared Node real-memory smoke helper to scan a real source process through `/proc/<pid>/maps` and `/proc/<pid>/mem`, produce `machinen.nodejs.memory-ir`, and materialize the decoded semantic state in target-native Node.

It does not claim raw V8 heap restore, raw VM replay, same PID continuation, or arbitrary Node process restore.
