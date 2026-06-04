#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "208-memory-real-large-numeric-graph-state",
  rowDir: "portability/nodejs/208-memory-real-large-numeric-graph-state",
  kind: "machinen.nodejs-portability-memory-real-large-numeric-graph-state-smoke-report",
  shape: "large-numeric-graph-state",
  anchors: {
    anchor: "machinen-real-large-numeric-graph-state-anchor-v1",
    marker: "large-numeric-graph-state:semantic-state",
  },
  semanticState: {
    kind: "large-numeric-graph-state",
    anchor: "machinen-real-large-numeric-graph-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
