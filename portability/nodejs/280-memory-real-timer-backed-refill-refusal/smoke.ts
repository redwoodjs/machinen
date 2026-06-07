#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "280-memory-real-timer-backed-refill-refusal",
  rowDir: "portability/nodejs/280-memory-real-timer-backed-refill-refusal",
  kind: "machinen.nodejs-portability-memory-real-timer-backed-refill-refusal-smoke-report",
  shape: "timer-backed-refill",
  anchors: {
    anchor: "machinen-real-timer-backed-refill-refusal-anchor-v1",
    marker: "rate-limiting:timer-backed-refill-refusal:unsupported",
  },
  semanticState: {
    kind: "timer-backed-refill-refusal",
    anchor: "machinen-real-timer-backed-refill-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-timer-backed-refill-unsupported",
  refusalReason:
    "timer backed refill refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
