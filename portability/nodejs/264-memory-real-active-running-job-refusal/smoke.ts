#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "264-memory-real-active-running-job-refusal",
  rowDir: "portability/nodejs/264-memory-real-active-running-job-refusal",
  kind: "machinen.nodejs-portability-memory-real-active-running-job-refusal-smoke-report",
  shape: "active-running-job",
  anchors: {
    anchor: "machinen-real-active-running-job-refusal-anchor-v1",
    marker: "job-schedulers:active-running-job-refusal:unsupported",
  },
  semanticState: {
    kind: "active-running-job-refusal",
    anchor: "machinen-real-active-running-job-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-active-running-job-unsupported",
  refusalReason:
    "active running job refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
