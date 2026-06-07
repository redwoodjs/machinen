#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "267-memory-real-scheduler-timer-refusal",
  rowDir: "portability/nodejs/267-memory-real-scheduler-timer-refusal",
  kind: "machinen.nodejs-portability-memory-real-scheduler-timer-refusal-smoke-report",
  shape: "scheduler-timer",
  anchors: {
    anchor: "machinen-real-scheduler-timer-refusal-anchor-v1",
    marker: "job-schedulers:scheduler-timer-refusal:unsupported",
  },
  semanticState: {
    kind: "scheduler-timer-refusal",
    anchor: "machinen-real-scheduler-timer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-scheduler-timer-unsupported",
  refusalReason:
    "scheduler timer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
