#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "091-memory-real-pipeline-refusal",
  rowDir: "portability/nodejs/091-memory-real-pipeline-refusal",
  kind: "machinen.nodejs-portability-memory-real-pipeline-refusal-smoke-report",
  shape: "pipeline",
  anchors: {
    anchor: "machinen-real-pipeline-refusal-anchor-v1",
    marker: "stream-detail:pipeline-refusal:unsupported",
  },
  semanticState: {
    kind: "pipeline-refusal",
    anchor: "machinen-real-pipeline-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-pipeline-unsupported",
  refusalReason:
    "pipeline refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
