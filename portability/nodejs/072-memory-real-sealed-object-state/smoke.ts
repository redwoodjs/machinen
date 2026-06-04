#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "072-memory-real-sealed-object-state",
  rowDir: "portability/nodejs/072-memory-real-sealed-object-state",
  kind: "machinen.nodejs-portability-memory-real-sealed-object-state-smoke-report",
  shape: "sealed-object-state",
  anchors: {
    anchor: "machinen-real-sealed-object-state-anchor-v1",
    marker: "object-mechanics:sealed-object-state:unsupported",
  },
  semanticState: {
    kind: "sealed-object-state",
    anchor: "machinen-real-sealed-object-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-sealed-object-unsupported",
  refusalReason:
    "sealed object state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
