#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "137-memory-real-bound-method-refusal",
  rowDir: "portability/nodejs/137-memory-real-bound-method-refusal",
  kind: "machinen.nodejs-portability-memory-real-bound-method-refusal-smoke-report",
  shape: "bound-method",
  anchors: {
    anchor: "machinen-real-bound-method-refusal-anchor-v1",
    marker: "class-prototype:bound-method-refusal:unsupported",
  },
  semanticState: {
    kind: "bound-method-refusal",
    anchor: "machinen-real-bound-method-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-bound-method-unsupported",
  refusalReason:
    "bound method refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
