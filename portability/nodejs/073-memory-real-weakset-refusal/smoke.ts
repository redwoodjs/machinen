#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "073-memory-real-weakset-refusal",
  rowDir: "portability/nodejs/073-memory-real-weakset-refusal",
  kind: "machinen.nodejs-portability-memory-real-weakset-refusal-smoke-report",
  shape: "weakset",
  anchors: {
    anchor: "machinen-real-weakset-refusal-anchor-v1",
    marker: "weak-gc-state:weakset-refusal:unsupported",
  },
  semanticState: {
    kind: "weakset-refusal",
    anchor: "machinen-real-weakset-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-weakset-unsupported",
  refusalReason:
    "weakset refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
