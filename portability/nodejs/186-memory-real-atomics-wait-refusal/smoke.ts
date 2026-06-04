#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "186-memory-real-atomics-wait-refusal",
  rowDir: "portability/nodejs/186-memory-real-atomics-wait-refusal",
  kind: "machinen.nodejs-portability-memory-real-atomics-wait-refusal-smoke-report",
  shape: "atomics-wait",
  anchors: {
    anchor: "machinen-real-atomics-wait-refusal-anchor-v1",
    marker: "worker-boundary:atomics-wait-refusal:unsupported",
  },
  semanticState: {
    kind: "atomics-wait-refusal",
    anchor: "machinen-real-atomics-wait-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-atomics-wait-unsupported",
  refusalReason:
    "atomics wait refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
