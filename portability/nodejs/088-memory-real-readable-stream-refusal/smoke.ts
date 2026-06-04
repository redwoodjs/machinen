#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "088-memory-real-readable-stream-refusal",
  rowDir: "portability/nodejs/088-memory-real-readable-stream-refusal",
  kind: "machinen.nodejs-portability-memory-real-readable-stream-refusal-smoke-report",
  shape: "readable-stream",
  anchors: {
    anchor: "machinen-real-readable-stream-refusal-anchor-v1",
    marker: "stream-detail:readable-stream-refusal:unsupported",
  },
  semanticState: {
    kind: "readable-stream-refusal",
    anchor: "machinen-real-readable-stream-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-readable-stream-unsupported",
  refusalReason:
    "readable stream refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
