#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "148-memory-real-priority-queue-state",
  rowDir: "portability/nodejs/148-memory-real-priority-queue-state",
  kind: "machinen.nodejs-portability-memory-real-priority-queue-state-smoke-report",
  shape: "priority-queue-state",
  anchors: {
    anchor: "machinen-real-priority-queue-state-anchor-v1",
    marker: "priority-queue-state:semantic-state",
  },
  semanticState: {
    kind: "priority-queue-state",
    anchor: "machinen-real-priority-queue-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
