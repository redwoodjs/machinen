#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "283-memory-real-metric-counters-state",
  rowDir: "portability/nodejs/283-memory-real-metric-counters-state",
  kind: "machinen.nodejs-portability-memory-real-metric-counters-state-smoke-report",
  shape: "metric-counters-state",
  anchors: {
    anchor: "machinen-real-metric-counters-state-anchor-v1",
    marker: "metric-counters-state:semantic-state",
  },
  semanticState: {
    kind: "metric-counters-state",
    anchor: "machinen-real-metric-counters-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
