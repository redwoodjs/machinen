#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "297-memory-real-partial-cache-state",
  rowDir: "portability/nodejs/297-memory-real-partial-cache-state",
  kind: "machinen.nodejs-portability-memory-real-partial-cache-state-smoke-report",
  shape: "partial-cache-state",
  anchors: {
    anchor: "machinen-real-partial-cache-state-anchor-v1",
    marker: "partial-cache-state:semantic-state",
  },
  semanticState: {
    kind: "partial-cache-state",
    anchor: "machinen-real-partial-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
