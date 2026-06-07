#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "155-memory-real-pending-transition-refusal",
  rowDir: "portability/nodejs/155-memory-real-pending-transition-refusal",
  kind: "machinen.nodejs-portability-memory-real-pending-transition-refusal-smoke-report",
  shape: "pending-transition",
  anchors: {
    anchor: "machinen-real-pending-transition-refusal-anchor-v1",
    marker: "state-machine:pending-transition-refusal:unsupported",
  },
  semanticState: {
    kind: "pending-transition-refusal",
    anchor: "machinen-real-pending-transition-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-pending-transition-unsupported",
  refusalReason:
    "pending transition refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
