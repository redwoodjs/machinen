#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "128-memory-real-bigint64array-state",
  rowDir: "portability/nodejs/128-memory-real-bigint64array-state",
  kind: "machinen.nodejs-portability-memory-real-bigint64array-state-smoke-report",
  shape: "bigint64array-state",
  anchors: {
    anchor: "machinen-real-bigint64array-state-anchor-v1",
    marker: "bigint64array-state:semantic-state",
  },
  semanticState: {
    kind: "bigint64array-state",
    anchor: "machinen-real-bigint64array-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
