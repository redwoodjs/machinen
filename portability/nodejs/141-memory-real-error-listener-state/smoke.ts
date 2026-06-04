#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "141-memory-real-error-listener-state",
  rowDir: "portability/nodejs/141-memory-real-error-listener-state",
  kind: "machinen.nodejs-portability-memory-real-error-listener-state-smoke-report",
  shape: "error-listener-state",
  anchors: {
    anchor: "machinen-real-error-listener-state-anchor-v1",
    marker: "error-listener-state:semantic-state",
  },
  semanticState: {
    kind: "error-listener-state",
    anchor: "machinen-real-error-listener-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
