#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "153-memory-real-enum-state-machine-state",
  rowDir: "portability/nodejs/153-memory-real-enum-state-machine-state",
  kind: "machinen.nodejs-portability-memory-real-enum-state-machine-state-smoke-report",
  shape: "enum-state-machine-state",
  anchors: {
    anchor: "machinen-real-enum-state-machine-state-anchor-v1",
    marker: "enum-state-machine-state:semantic-state",
  },
  semanticState: {
    kind: "enum-state-machine-state",
    anchor: "machinen-real-enum-state-machine-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
