#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "129-memory-real-float64array-state",
  rowDir: "portability/nodejs/129-memory-real-float64array-state",
  kind: "machinen.nodejs-portability-memory-real-float64array-state-smoke-report",
  shape: "float64array-state",
  anchors: {
    anchor: "machinen-real-float64array-state-anchor-v1",
    marker: "float64array-state:semantic-state",
  },
  semanticState: {
    kind: "float64array-state",
    anchor: "machinen-real-float64array-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
