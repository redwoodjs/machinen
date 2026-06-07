#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "087-memory-real-scheduled-callback-refusal",
  rowDir: "portability/nodejs/087-memory-real-scheduled-callback-refusal",
  kind: "machinen.nodejs-portability-memory-real-scheduled-callback-refusal-smoke-report",
  shape: "scheduled-callback",
  anchors: {
    anchor: "machinen-real-scheduled-callback-refusal-anchor-v1",
    marker: "timer-detail:scheduled-callback-refusal:unsupported",
  },
  semanticState: {
    kind: "scheduled-callback-refusal",
    anchor: "machinen-real-scheduled-callback-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-scheduled-callback-unsupported",
  refusalReason:
    "scheduled callback refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
