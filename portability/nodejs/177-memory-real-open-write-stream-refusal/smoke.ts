#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "177-memory-real-open-write-stream-refusal",
  rowDir: "portability/nodejs/177-memory-real-open-write-stream-refusal",
  kind: "machinen.nodejs-portability-memory-real-open-write-stream-refusal-smoke-report",
  shape: "open-write-stream",
  anchors: {
    anchor: "machinen-real-open-write-stream-refusal-anchor-v1",
    marker: "filesystem-handles:open-write-stream-refusal:unsupported",
  },
  semanticState: {
    kind: "open-write-stream-refusal",
    anchor: "machinen-real-open-write-stream-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-open-write-stream-unsupported",
  refusalReason:
    "open write stream refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
