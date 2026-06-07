#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "132-memory-real-typedarray-subarray-state",
  rowDir: "portability/nodejs/132-memory-real-typedarray-subarray-state",
  kind: "machinen.nodejs-portability-memory-real-typedarray-subarray-state-smoke-report",
  shape: "typedarray-subarray-state",
  anchors: {
    anchor: "machinen-real-typedarray-subarray-state-anchor-v1",
    marker: "typedarray-subarray-state:semantic-state",
  },
  semanticState: {
    kind: "typedarray-subarray-state",
    anchor: "machinen-real-typedarray-subarray-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
