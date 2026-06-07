#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "239-memory-real-completed-compressed-buffer-state",
  rowDir: "portability/nodejs/239-memory-real-completed-compressed-buffer-state",
  kind: "machinen.nodejs-portability-memory-real-completed-compressed-buffer-state-smoke-report",
  shape: "completed-compressed-buffer-state",
  anchors: {
    anchor: "machinen-real-completed-compressed-buffer-state-anchor-v1",
    marker: "completed-compressed-buffer-state:semantic-state",
  },
  semanticState: {
    kind: "completed-compressed-buffer-state",
    anchor: "machinen-real-completed-compressed-buffer-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
