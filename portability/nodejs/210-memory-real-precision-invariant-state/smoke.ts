#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "210-memory-real-precision-invariant-state",
  rowDir: "portability/nodejs/210-memory-real-precision-invariant-state",
  kind: "machinen.nodejs-portability-memory-real-precision-invariant-state-smoke-report",
  shape: "precision-invariant-state",
  anchors: {
    anchor: "machinen-real-precision-invariant-state-anchor-v1",
    marker: "precision-invariant-state:semantic-state",
  },
  semanticState: {
    kind: "precision-invariant-state",
    anchor: "machinen-real-precision-invariant-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
