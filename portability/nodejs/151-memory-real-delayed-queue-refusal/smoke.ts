#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "151-memory-real-delayed-queue-refusal",
  rowDir: "portability/nodejs/151-memory-real-delayed-queue-refusal",
  kind: "machinen.nodejs-portability-memory-real-delayed-queue-refusal-smoke-report",
  shape: "delayed-queue",
  anchors: {
    anchor: "machinen-real-delayed-queue-refusal-anchor-v1",
    marker: "queue-policy:delayed-queue-refusal:unsupported",
  },
  semanticState: {
    kind: "delayed-queue-refusal",
    anchor: "machinen-real-delayed-queue-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-delayed-queue-unsupported",
  refusalReason:
    "delayed queue refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
