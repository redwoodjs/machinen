#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "236-memory-real-diagnostic-report-refusal",
  rowDir: "portability/nodejs/236-memory-real-diagnostic-report-refusal",
  kind: "machinen.nodejs-portability-memory-real-diagnostic-report-refusal-smoke-report",
  shape: "diagnostic-report",
  anchors: {
    anchor: "machinen-real-diagnostic-report-refusal-anchor-v1",
    marker: "diagnostics:diagnostic-report-refusal:unsupported",
  },
  semanticState: {
    kind: "diagnostic-report-refusal",
    anchor: "machinen-real-diagnostic-report-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-diagnostic-report-unsupported",
  refusalReason:
    "diagnostic report refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
