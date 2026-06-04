#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "071-memory-real-frozen-object-state",
  rowDir: "portability/nodejs/071-memory-real-frozen-object-state",
  kind: "machinen.nodejs-portability-memory-real-frozen-object-state-smoke-report",
  shape: "frozen-object-state",
  anchors: {
    anchor: "machinen-real-frozen-object-state-anchor-v1",
    marker: "object-mechanics:frozen-object-state:unsupported",
  },
  semanticState: {
    kind: "frozen-object-state",
    anchor: "machinen-real-frozen-object-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-frozen-object-unsupported",
  refusalReason:
    "frozen object state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
