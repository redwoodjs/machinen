#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "203-memory-real-global-symbol-registry-state",
  rowDir: "portability/nodejs/203-memory-real-global-symbol-registry-state",
  kind: "machinen.nodejs-portability-memory-real-global-symbol-registry-state-smoke-report",
  shape: "global-symbol-registry-state",
  anchors: {
    anchor: "machinen-real-global-symbol-registry-state-anchor-v1",
    marker: "global-symbol-registry-state:semantic-state",
  },
  semanticState: {
    kind: "global-symbol-registry-state",
    anchor: "machinen-real-global-symbol-registry-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
