# 021 — memory scalar counter

This smoke covers one memory-only Node.js state dimension:

- source keeps `count = 41` in V8 process memory
- capture reads guest `/proc/<pid>/mem`
- capture decodes an anchored V8 context Smi scalar
- target starts fresh target-native Node with the captured value
- verifier observes `41 -> 42`

This is a portability smoke row, not an arbitrary Node process/heap restore claim.
