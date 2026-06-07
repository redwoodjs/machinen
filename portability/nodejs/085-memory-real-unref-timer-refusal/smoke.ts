#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "085-memory-real-unref-timer-refusal",
  rowDir: "portability/nodejs/085-memory-real-unref-timer-refusal",
  kind: "machinen.nodejs-portability-memory-real-unref-timer-refusal-smoke-report",
  shape: "unref-timer",
  anchors: {
    anchor: "machinen-real-unref-timer-refusal-anchor-v1",
    marker: "timer-detail:unref-timer-refusal:unsupported",
  },
  semanticState: {
    kind: "unref-timer-refusal",
    anchor: "machinen-real-unref-timer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-unref-timer-unsupported",
  refusalReason:
    "unref timer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
