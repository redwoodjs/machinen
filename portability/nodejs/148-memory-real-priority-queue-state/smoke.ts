#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "148-memory-real-priority-queue-state",
  rowDir: "portability/nodejs/148-memory-real-priority-queue-state",
  kind: "machinen.nodejs-portability-memory-real-priority-queue-state-smoke-report",
  shape: "priority-queue-state",
  anchors: {
    anchor: "machinen-real-priority-queue-state-anchor-v1",
    marker: "queue-policy:priority-queue-state:unsupported",
  },
  semanticState: {
    kind: "priority-queue-state",
    anchor: "machinen-real-priority-queue-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-priority-queue-unsupported",
  refusalReason:
    "priority queue state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
