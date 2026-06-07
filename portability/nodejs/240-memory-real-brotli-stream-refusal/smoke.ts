#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "240-memory-real-brotli-stream-refusal",
  rowDir: "portability/nodejs/240-memory-real-brotli-stream-refusal",
  kind: "machinen.nodejs-portability-memory-real-brotli-stream-refusal-smoke-report",
  shape: "brotli-stream",
  anchors: {
    anchor: "machinen-real-brotli-stream-refusal-anchor-v1",
    marker: "compression:brotli-stream-refusal:unsupported",
  },
  semanticState: {
    kind: "brotli-stream-refusal",
    anchor: "machinen-real-brotli-stream-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-brotli-stream-unsupported",
  refusalReason:
    "brotli stream refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
