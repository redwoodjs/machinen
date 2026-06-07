#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "121-memory-real-error-stack-refusal",
  rowDir: "portability/nodejs/121-memory-real-error-stack-refusal",
  kind: "machinen.nodejs-portability-memory-real-error-stack-refusal-smoke-report",
  shape: "error-stack",
  anchors: {
    anchor: "machinen-real-error-stack-refusal-anchor-v1",
    marker: "error-advanced:error-stack-refusal:unsupported",
  },
  semanticState: {
    kind: "error-stack-refusal",
    anchor: "machinen-real-error-stack-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-error-stack-unsupported",
  refusalReason:
    "error stack refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
