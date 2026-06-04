#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "212-memory-real-decimal-string-state",
  rowDir: "portability/nodejs/212-memory-real-decimal-string-state",
  kind: "machinen.nodejs-portability-memory-real-decimal-string-state-smoke-report",
  shape: "decimal-string-state",
  anchors: {
    anchor: "machinen-real-decimal-string-state-anchor-v1",
    marker: "decimal-string-state:semantic-state",
  },
  semanticState: {
    kind: "decimal-string-state",
    anchor: "machinen-real-decimal-string-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
