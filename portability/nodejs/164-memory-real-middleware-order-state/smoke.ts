#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "164-memory-real-middleware-order-state",
  rowDir: "portability/nodejs/164-memory-real-middleware-order-state",
  kind: "machinen.nodejs-portability-memory-real-middleware-order-state-smoke-report",
  shape: "middleware-order-state",
  anchors: {
    anchor: "machinen-real-middleware-order-state-anchor-v1",
    marker: "middleware-order-state:semantic-state",
  },
  semanticState: {
    kind: "middleware-order-state",
    anchor: "machinen-real-middleware-order-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
