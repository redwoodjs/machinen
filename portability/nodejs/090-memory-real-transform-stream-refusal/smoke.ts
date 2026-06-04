#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "090-memory-real-transform-stream-refusal",
  rowDir: "portability/nodejs/090-memory-real-transform-stream-refusal",
  kind: "machinen.nodejs-portability-memory-real-transform-stream-refusal-smoke-report",
  shape: "transform-stream",
  anchors: {
    anchor: "machinen-real-transform-stream-refusal-anchor-v1",
    marker: "stream-detail:transform-stream-refusal:unsupported",
  },
  semanticState: {
    kind: "transform-stream-refusal",
    anchor: "machinen-real-transform-stream-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-transform-stream-unsupported",
  refusalReason:
    "transform stream refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
