#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "266-memory-real-job-lock-refusal",
  rowDir: "portability/nodejs/266-memory-real-job-lock-refusal",
  kind: "machinen.nodejs-portability-memory-real-job-lock-refusal-smoke-report",
  shape: "job-lock",
  anchors: {
    anchor: "machinen-real-job-lock-refusal-anchor-v1",
    marker: "job-schedulers:job-lock-refusal:unsupported",
  },
  semanticState: {
    kind: "job-lock-refusal",
    anchor: "machinen-real-job-lock-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-job-lock-unsupported",
  refusalReason:
    "job lock refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
