#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "170-memory-real-di-container-singleton-state",
  rowDir: "portability/nodejs/170-memory-real-di-container-singleton-state",
  kind: "machinen.nodejs-portability-memory-real-di-container-singleton-state-smoke-report",
  shape: "di-container-singleton-state",
  anchors: {
    anchor: "machinen-real-di-container-singleton-state-anchor-v1",
    marker: "di-container-singleton-state:semantic-state",
  },
  semanticState: {
    kind: "di-container-singleton-state",
    anchor: "machinen-real-di-container-singleton-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
