#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "269-memory-real-index-map-state",
  rowDir: "portability/nodejs/269-memory-real-index-map-state",
  kind: "machinen.nodejs-portability-memory-real-index-map-state-smoke-report",
  shape: "index-map-state",
  anchors: {
    anchor: "machinen-real-index-map-state-anchor-v1",
    marker: "index-map-state:semantic-state",
  },
  semanticState: {
    kind: "index-map-state",
    anchor: "machinen-real-index-map-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
