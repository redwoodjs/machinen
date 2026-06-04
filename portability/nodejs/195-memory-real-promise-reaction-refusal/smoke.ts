#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "195-memory-real-promise-reaction-refusal",
  rowDir: "portability/nodejs/195-memory-real-promise-reaction-refusal",
  kind: "machinen.nodejs-portability-memory-real-promise-reaction-refusal-smoke-report",
  shape: "promise-reaction",
  anchors: {
    anchor: "machinen-real-promise-reaction-refusal-anchor-v1",
    marker: "promise-detail:promise-reaction-refusal:unsupported",
  },
  semanticState: {
    kind: "promise-reaction-refusal",
    anchor: "machinen-real-promise-reaction-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-promise-reaction-unsupported",
  refusalReason:
    "promise reaction refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
