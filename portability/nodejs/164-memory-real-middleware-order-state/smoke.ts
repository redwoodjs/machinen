#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "164-memory-real-middleware-order-state",
  rowDir: "portability/nodejs/164-memory-real-middleware-order-state",
  kind: "machinen.nodejs-portability-memory-real-middleware-order-state-smoke-report",
  shape: "middleware-order-state",
  anchors: {
    anchor: "machinen-real-middleware-order-state-anchor-v1",
    marker: "http-app-state:middleware-order-state:unsupported",
  },
  semanticState: {
    kind: "middleware-order-state",
    anchor: "machinen-real-middleware-order-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-middleware-order-unsupported",
  refusalReason:
    "middleware order state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
