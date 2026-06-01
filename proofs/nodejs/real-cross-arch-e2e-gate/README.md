# Node real cross-architecture E2E gate required

Status: `not-started`

This gate blocks public Node product/broad claims until retained real VM E2E artifacts are audited or produced.

Required proof rows:

1. Audit every claimed supported Node row for retained source/target VM E2E bundles.
2. Real `amd64 -> arm64` `machinen snapshot <vm-name>` / `machinen restore <dir>` run with target behavior verification.
3. Real `arm64 -> amd64` run with target behavior verification.
4. Refusal artifacts for unsupported live/runtime states.

Until this passes, Node is tracked as `0 / 0 / 0` in the claim dashboard.
