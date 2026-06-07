#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "163-memory-real-route-table-state",
  rowDir: "portability/nodejs/163-memory-real-route-table-state",
  kind: "machinen.nodejs-portability-memory-real-route-table-state-smoke-report",
  shape: "route-table-state",
  anchors: {
    anchor: "machinen-real-route-table-state-anchor-v1",
    marker: "route-table-state:semantic-state",
  },
  semanticState: {
    kind: "route-table-state",
    anchor: "machinen-real-route-table-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
