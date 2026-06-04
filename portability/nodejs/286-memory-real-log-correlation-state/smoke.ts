#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "286-memory-real-log-correlation-state",
  rowDir: "portability/nodejs/286-memory-real-log-correlation-state",
  kind: "machinen.nodejs-portability-memory-real-log-correlation-state-smoke-report",
  shape: "log-correlation-state",
  anchors: {
    anchor: "machinen-real-log-correlation-state-anchor-v1",
    marker: "log-correlation-state:semantic-state",
  },
  semanticState: {
    kind: "log-correlation-state",
    anchor: "machinen-real-log-correlation-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
