#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "198-memory-real-json-graph-state",
  rowDir: "portability/nodejs/198-memory-real-json-graph-state",
  kind: "machinen.nodejs-portability-memory-real-json-graph-state-smoke-report",
  shape: "json-graph-state",
  anchors: {
    anchor: "machinen-real-json-graph-state-anchor-v1",
    marker: "json-graph-state:semantic-state",
  },
  semanticState: {
    kind: "json-graph-state",
    anchor: "machinen-real-json-graph-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
