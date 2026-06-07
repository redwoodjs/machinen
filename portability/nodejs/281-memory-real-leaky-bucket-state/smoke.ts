#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "281-memory-real-leaky-bucket-state",
  rowDir: "portability/nodejs/281-memory-real-leaky-bucket-state",
  kind: "machinen.nodejs-portability-memory-real-leaky-bucket-state-smoke-report",
  shape: "leaky-bucket-state",
  anchors: {
    anchor: "machinen-real-leaky-bucket-state-anchor-v1",
    marker: "leaky-bucket-state:semantic-state",
  },
  semanticState: {
    kind: "leaky-bucket-state",
    anchor: "machinen-real-leaky-bucket-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
