#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "115-memory-real-ordered-set-graph-state",
  rowDir: "portability/nodejs/115-memory-real-ordered-set-graph-state",
  kind: "machinen.nodejs-portability-memory-real-ordered-set-graph-state-smoke-report",
  shape: "ordered-set-graph-state",
  anchors: {
    anchor: "machinen-real-ordered-set-graph-state-anchor-v1",
    marker: "ordered-set-graph-state:semantic-state",
  },
  semanticState: {
    kind: "ordered-set-graph-state",
    anchor: "machinen-real-ordered-set-graph-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
