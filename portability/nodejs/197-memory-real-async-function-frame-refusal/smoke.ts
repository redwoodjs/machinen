#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "197-memory-real-async-function-frame-refusal",
  rowDir: "portability/nodejs/197-memory-real-async-function-frame-refusal",
  kind: "machinen.nodejs-portability-memory-real-async-function-frame-refusal-smoke-report",
  shape: "async-function-frame",
  anchors: {
    anchor: "machinen-real-async-function-frame-refusal-anchor-v1",
    marker: "promise-detail:async-function-frame-refusal:unsupported",
  },
  semanticState: {
    kind: "async-function-frame-refusal",
    anchor: "machinen-real-async-function-frame-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-async-function-frame-unsupported",
  refusalReason:
    "async function frame refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
