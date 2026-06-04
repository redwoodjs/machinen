#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "075-memory-real-weakref-refusal",
  rowDir: "portability/nodejs/075-memory-real-weakref-refusal",
  kind: "machinen.nodejs-portability-memory-real-weakref-refusal-smoke-report",
  shape: "weakref",
  anchors: {
    anchor: "machinen-real-weakref-refusal-anchor-v1",
    marker: "weak-gc-state:weakref-refusal:unsupported",
  },
  semanticState: {
    kind: "weakref-refusal",
    anchor: "machinen-real-weakref-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-weakref-unsupported",
  refusalReason:
    "weakref refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
