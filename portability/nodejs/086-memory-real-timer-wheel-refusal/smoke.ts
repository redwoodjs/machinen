#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "086-memory-real-timer-wheel-refusal",
  rowDir: "portability/nodejs/086-memory-real-timer-wheel-refusal",
  kind: "machinen.nodejs-portability-memory-real-timer-wheel-refusal-smoke-report",
  shape: "timer-wheel",
  anchors: {
    anchor: "machinen-real-timer-wheel-refusal-anchor-v1",
    marker: "timer-detail:timer-wheel-refusal:unsupported",
  },
  semanticState: {
    kind: "timer-wheel-refusal",
    anchor: "machinen-real-timer-wheel-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-timer-wheel-unsupported",
  refusalReason:
    "timer wheel refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
