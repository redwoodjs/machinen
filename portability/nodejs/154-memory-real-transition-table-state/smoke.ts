#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "154-memory-real-transition-table-state",
  rowDir: "portability/nodejs/154-memory-real-transition-table-state",
  kind: "machinen.nodejs-portability-memory-real-transition-table-state-smoke-report",
  shape: "transition-table-state",
  anchors: {
    anchor: "machinen-real-transition-table-state-anchor-v1",
    marker: "transition-table-state:semantic-state",
  },
  semanticState: {
    kind: "transition-table-state",
    anchor: "machinen-real-transition-table-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
