#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "218-memory-real-date-graph-state",
  rowDir: "portability/nodejs/218-memory-real-date-graph-state",
  kind: "machinen.nodejs-portability-memory-real-date-graph-state-smoke-report",
  shape: "date-graph-state",
  anchors: {
    anchor: "machinen-real-date-graph-state-anchor-v1",
    marker: "date-graph-state:semantic-state",
  },
  semanticState: {
    kind: "date-graph-state",
    anchor: "machinen-real-date-graph-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
