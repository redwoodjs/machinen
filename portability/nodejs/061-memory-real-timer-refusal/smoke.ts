#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "061-memory-real-timer-refusal",
  rowDir: "portability/nodejs/061-memory-real-timer-refusal",
  kind: "machinen.nodejs-portability-memory-real-active-timer-refusal-smoke-report",
  shape: "active-timer",
  anchors: {
    anchor: "machinen-real-timer-refusal-anchor-v1",
    timer: "timer:active-timeout-handle",
  },
  semanticState: {
    kind: "active-timer",
    anchor: "machinen-real-timer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-timer-unsupported",
  refusalReason:
    "active timer queue state is live event-loop state and is refused until separately proven",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
