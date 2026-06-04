#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "150-memory-real-retry-queue-state",
  rowDir: "portability/nodejs/150-memory-real-retry-queue-state",
  kind: "machinen.nodejs-portability-memory-real-retry-queue-state-smoke-report",
  shape: "retry-queue-state",
  anchors: {
    anchor: "machinen-real-retry-queue-state-anchor-v1",
    marker: "retry-queue-state:semantic-state",
  },
  semanticState: {
    kind: "retry-queue-state",
    anchor: "machinen-real-retry-queue-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
