#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "233-memory-real-counter-state",
  rowDir: "portability/nodejs/233-memory-real-counter-state",
  kind: "machinen.nodejs-portability-memory-real-counter-state-smoke-report",
  shape: "counter-state",
  anchors: {
    anchor: "machinen-real-counter-state-anchor-v1",
    marker: "counter-state:semantic-state",
  },
  semanticState: {
    kind: "counter-state",
    anchor: "machinen-real-counter-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
