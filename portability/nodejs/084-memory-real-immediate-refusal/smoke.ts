#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "084-memory-real-immediate-refusal",
  rowDir: "portability/nodejs/084-memory-real-immediate-refusal",
  kind: "machinen.nodejs-portability-memory-real-immediate-refusal-smoke-report",
  shape: "immediate",
  anchors: {
    anchor: "machinen-real-immediate-refusal-anchor-v1",
    marker: "timer-detail:immediate-refusal:unsupported",
  },
  semanticState: {
    kind: "immediate-refusal",
    anchor: "machinen-real-immediate-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-immediate-unsupported",
  refusalReason:
    "immediate refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
