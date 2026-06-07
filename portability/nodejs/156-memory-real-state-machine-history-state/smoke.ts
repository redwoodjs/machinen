#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "156-memory-real-state-machine-history-state",
  rowDir: "portability/nodejs/156-memory-real-state-machine-history-state",
  kind: "machinen.nodejs-portability-memory-real-state-machine-history-state-smoke-report",
  shape: "state-machine-history-state",
  anchors: {
    anchor: "machinen-real-state-machine-history-state-anchor-v1",
    marker: "state-machine-history-state:semantic-state",
  },
  semanticState: {
    kind: "state-machine-history-state",
    anchor: "machinen-real-state-machine-history-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
