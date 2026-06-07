#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "268-memory-real-simple-table-map-state",
  rowDir: "portability/nodejs/268-memory-real-simple-table-map-state",
  kind: "machinen.nodejs-portability-memory-real-simple-table-map-state-smoke-report",
  shape: "simple-table-map-state",
  anchors: {
    anchor: "machinen-real-simple-table-map-state-anchor-v1",
    marker: "simple-table-map-state:semantic-state",
  },
  semanticState: {
    kind: "simple-table-map-state",
    anchor: "machinen-real-simple-table-map-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
