#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "234-memory-real-histogram-state",
  rowDir: "portability/nodejs/234-memory-real-histogram-state",
  kind: "machinen.nodejs-portability-memory-real-histogram-state-smoke-report",
  shape: "histogram-state",
  anchors: {
    anchor: "machinen-real-histogram-state-anchor-v1",
    marker: "histogram-state:semantic-state",
  },
  semanticState: {
    kind: "histogram-state",
    anchor: "machinen-real-histogram-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
