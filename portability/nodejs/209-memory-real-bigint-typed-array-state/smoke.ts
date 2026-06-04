#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "209-memory-real-bigint-typed-array-state",
  rowDir: "portability/nodejs/209-memory-real-bigint-typed-array-state",
  kind: "machinen.nodejs-portability-memory-real-bigint-typed-array-state-smoke-report",
  shape: "bigint-typed-array-state",
  anchors: {
    anchor: "machinen-real-bigint-typed-array-state-anchor-v1",
    marker: "bigint-math:bigint-typed-array-state:unsupported",
  },
  semanticState: {
    kind: "bigint-typed-array-state",
    anchor: "machinen-real-bigint-typed-array-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-bigint-typed-array-unsupported",
  refusalReason:
    "bigint typed array state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
