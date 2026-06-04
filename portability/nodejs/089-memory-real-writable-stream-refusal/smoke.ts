#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "089-memory-real-writable-stream-refusal",
  rowDir: "portability/nodejs/089-memory-real-writable-stream-refusal",
  kind: "machinen.nodejs-portability-memory-real-writable-stream-refusal-smoke-report",
  shape: "writable-stream",
  anchors: {
    anchor: "machinen-real-writable-stream-refusal-anchor-v1",
    marker: "stream-detail:writable-stream-refusal:unsupported",
  },
  semanticState: {
    kind: "writable-stream-refusal",
    anchor: "machinen-real-writable-stream-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-writable-stream-unsupported",
  refusalReason:
    "writable stream refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
