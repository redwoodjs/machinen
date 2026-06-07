#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "144-memory-real-nested-cache-state",
  rowDir: "portability/nodejs/144-memory-real-nested-cache-state",
  kind: "machinen.nodejs-portability-memory-real-nested-cache-state-smoke-report",
  shape: "nested-cache-state",
  anchors: {
    anchor: "machinen-real-nested-cache-state-anchor-v1",
    marker: "nested-cache-state:semantic-state",
  },
  semanticState: {
    kind: "nested-cache-state",
    anchor: "machinen-real-nested-cache-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
