#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "209-memory-real-bigint-typed-array-state",
  rowDir: "portability/nodejs/209-memory-real-bigint-typed-array-state",
  kind: "machinen.nodejs-portability-memory-real-bigint-typed-array-state-smoke-report",
  shape: "bigint-typed-array-state",
  anchors: {
    anchor: "machinen-real-bigint-typed-array-state-anchor-v1",
    marker: "bigint-typed-array-state:semantic-state",
  },
  semanticState: {
    kind: "bigint-typed-array-state",
    anchor: "machinen-real-bigint-typed-array-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
