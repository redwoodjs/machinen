#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "196-memory-real-microtask-queue-refusal",
  rowDir: "portability/nodejs/196-memory-real-microtask-queue-refusal",
  kind: "machinen.nodejs-portability-memory-real-microtask-queue-refusal-smoke-report",
  shape: "microtask-queue",
  anchors: {
    anchor: "machinen-real-microtask-queue-refusal-anchor-v1",
    marker: "promise-detail:microtask-queue-refusal:unsupported",
  },
  semanticState: {
    kind: "microtask-queue-refusal",
    anchor: "machinen-real-microtask-queue-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-microtask-queue-unsupported",
  refusalReason:
    "microtask queue refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
