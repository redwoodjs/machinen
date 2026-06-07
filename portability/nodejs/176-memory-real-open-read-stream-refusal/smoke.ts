#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "176-memory-real-open-read-stream-refusal",
  rowDir: "portability/nodejs/176-memory-real-open-read-stream-refusal",
  kind: "machinen.nodejs-portability-memory-real-open-read-stream-refusal-smoke-report",
  shape: "open-read-stream",
  anchors: {
    anchor: "machinen-real-open-read-stream-refusal-anchor-v1",
    marker: "filesystem-handles:open-read-stream-refusal:unsupported",
  },
  semanticState: {
    kind: "open-read-stream-refusal",
    anchor: "machinen-real-open-read-stream-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-open-read-stream-unsupported",
  refusalReason:
    "open read stream refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
