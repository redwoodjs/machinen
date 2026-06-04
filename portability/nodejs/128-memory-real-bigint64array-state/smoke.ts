#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "128-memory-real-bigint64array-state",
  rowDir: "portability/nodejs/128-memory-real-bigint64array-state",
  kind: "machinen.nodejs-portability-memory-real-bigint64array-state-smoke-report",
  shape: "bigint64array-state",
  anchors: {
    anchor: "machinen-real-bigint64array-state-anchor-v1",
    marker: "typed-array-advanced:bigint64array-state:unsupported",
  },
  semanticState: {
    kind: "bigint64array-state",
    anchor: "machinen-real-bigint64array-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-bigint64array-unsupported",
  refusalReason:
    "bigint64array state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
