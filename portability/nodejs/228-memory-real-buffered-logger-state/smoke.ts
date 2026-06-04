#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "228-memory-real-buffered-logger-state",
  rowDir: "portability/nodejs/228-memory-real-buffered-logger-state",
  kind: "machinen.nodejs-portability-memory-real-buffered-logger-state-smoke-report",
  shape: "buffered-logger-state",
  anchors: {
    anchor: "machinen-real-buffered-logger-state-anchor-v1",
    marker: "buffered-logger-state:semantic-state",
  },
  semanticState: {
    kind: "buffered-logger-state",
    anchor: "machinen-real-buffered-logger-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
