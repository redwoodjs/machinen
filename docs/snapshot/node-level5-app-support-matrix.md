# Node Level 5 app support matrix — proof substrate

This matrix is proof substrate only until the real cross-architecture VM E2E gate passes.

Current public Node claim:

```json
{
  "nodeProductSupportClaimed": 0,
  "broadNodeProductSupportClaimed": 0,
  "arbitraryProcessCrossArchRestoreClaimed": 0
}
```

Rows in the app support matrix can become claim-bearing only when connected to retained real `machinen snapshot <vm-name>` / `machinen restore <dir>` artifacts in both architecture directions, with target behavior verification and refusal artifacts.

The required gate is `proofs/nodejs/real-cross-arch-e2e-gate/`.

This matrix still does not claim arbitrary Express, arbitrary Fastify, arbitrary Node, raw cross-architecture CPU restore, or arbitrary Linux process restore.
