#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "238-memory-real-zlib-stream-refusal",
  rowDir: "portability/nodejs/238-memory-real-zlib-stream-refusal",
  kind: "machinen.nodejs-portability-memory-real-zlib-stream-refusal-smoke-report",
  shape: "zlib-stream",
  anchors: {
    anchor: "machinen-real-zlib-stream-refusal-anchor-v1",
    marker: "compression:zlib-stream-refusal:unsupported",
  },
  semanticState: {
    kind: "zlib-stream-refusal",
    anchor: "machinen-real-zlib-stream-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-zlib-stream-unsupported",
  refusalReason:
    "zlib stream refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
