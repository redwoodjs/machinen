#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "219-memory-real-timezone-independent-state",
  rowDir: "portability/nodejs/219-memory-real-timezone-independent-state",
  kind: "machinen.nodejs-portability-memory-real-timezone-independent-state-smoke-report",
  shape: "timezone-independent-state",
  anchors: {
    anchor: "machinen-real-timezone-independent-state-anchor-v1",
    marker: "timezone-independent-state:semantic-state",
  },
  semanticState: {
    kind: "timezone-independent-state",
    anchor: "machinen-real-timezone-independent-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
