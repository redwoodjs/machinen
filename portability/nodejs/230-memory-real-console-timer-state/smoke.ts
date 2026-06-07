#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "230-memory-real-console-timer-state",
  rowDir: "portability/nodejs/230-memory-real-console-timer-state",
  kind: "machinen.nodejs-portability-memory-real-console-timer-state-smoke-report",
  shape: "console-timer-state",
  anchors: {
    anchor: "machinen-real-console-timer-state-anchor-v1",
    marker: "console-timer-state:semantic-state",
  },
  semanticState: {
    kind: "console-timer-state",
    anchor: "machinen-real-console-timer-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
