#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "072-memory-real-sealed-object-state",
  rowDir: "portability/nodejs/072-memory-real-sealed-object-state",
  kind: "machinen.nodejs-portability-memory-real-sealed-object-state-smoke-report",
  shape: "sealed-object-state",
  anchors: {
    anchor: "machinen-real-sealed-object-state-anchor-v1",
    marker: "sealed-object-state:semantic-state",
  },
  semanticState: {
    kind: "sealed-object-state",
    anchor: "machinen-real-sealed-object-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
