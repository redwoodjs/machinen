#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "131-memory-real-dataview-offset-state",
  rowDir: "portability/nodejs/131-memory-real-dataview-offset-state",
  kind: "machinen.nodejs-portability-memory-real-dataview-offset-state-smoke-report",
  shape: "dataview-offset-state",
  anchors: {
    anchor: "machinen-real-dataview-offset-state-anchor-v1",
    marker: "dataview-offset-state:semantic-state",
  },
  semanticState: {
    kind: "dataview-offset-state",
    anchor: "machinen-real-dataview-offset-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
