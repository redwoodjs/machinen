#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "132-memory-real-typedarray-subarray-state",
  rowDir: "portability/nodejs/132-memory-real-typedarray-subarray-state",
  kind: "machinen.nodejs-portability-memory-real-typedarray-subarray-state-smoke-report",
  shape: "typedarray-subarray-state",
  anchors: {
    anchor: "machinen-real-typedarray-subarray-state-anchor-v1",
    marker: "typed-array-advanced:typedarray-subarray-state:unsupported",
  },
  semanticState: {
    kind: "typedarray-subarray-state",
    anchor: "machinen-real-typedarray-subarray-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-typedarray-subarray-unsupported",
  refusalReason:
    "typedarray subarray state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
