#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "071-memory-real-frozen-object-state",
  rowDir: "portability/nodejs/071-memory-real-frozen-object-state",
  kind: "machinen.nodejs-portability-memory-real-frozen-object-state-smoke-report",
  shape: "frozen-object-state",
  anchors: {
    anchor: "machinen-real-frozen-object-state-anchor-v1",
    marker: "frozen-object-state:semantic-state",
  },
  semanticState: {
    kind: "frozen-object-state",
    anchor: "machinen-real-frozen-object-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
