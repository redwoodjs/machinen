# 037 — real memory plain object

This row proves a selected Node plain-object memory-state portability path:

1. Start a real source Node process.
2. Read `/proc/<pid>/maps` and `/proc/<pid>/mem` from inside the source VM.
3. Decode a small semantic object-state IR from anchored field values found in source process memory.
4. Materialize that object in a target-native Node process on the opposite architecture.
5. Verify target behavior.

This is **not** raw V8 heap restore, same-PID continuation, arbitrary Node process
restore, or raw VM/vCPU/device replay.
