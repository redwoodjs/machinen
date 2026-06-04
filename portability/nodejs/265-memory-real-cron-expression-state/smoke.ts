#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "265-memory-real-cron-expression-state",
  rowDir: "portability/nodejs/265-memory-real-cron-expression-state",
  kind: "machinen.nodejs-portability-memory-real-cron-expression-state-smoke-report",
  shape: "cron-expression-state",
  anchors: {
    anchor: "machinen-real-cron-expression-state-anchor-v1",
    marker: "cron-expression-state:semantic-state",
  },
  semanticState: {
    kind: "cron-expression-state",
    anchor: "machinen-real-cron-expression-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
