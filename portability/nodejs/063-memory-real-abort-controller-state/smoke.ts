#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "063-memory-real-abort-controller-state",
  rowDir: "portability/nodejs/063-memory-real-abort-controller-state",
  kind: "machinen.nodejs-portability-memory-real-abort-controller-state-smoke-report",
  shape: "abort-controller-state",
  anchors: {
    anchor: "machinen-real-abort-controller-state-anchor-v1",
    marker: "abort-controller-state:semantic-state",
  },
  semanticState: {
    kind: "abort-controller-state",
    anchor: "machinen-real-abort-controller-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
