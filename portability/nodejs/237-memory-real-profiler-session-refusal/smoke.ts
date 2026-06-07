#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "237-memory-real-profiler-session-refusal",
  rowDir: "portability/nodejs/237-memory-real-profiler-session-refusal",
  kind: "machinen.nodejs-portability-memory-real-profiler-session-refusal-smoke-report",
  shape: "profiler-session",
  anchors: {
    anchor: "machinen-real-profiler-session-refusal-anchor-v1",
    marker: "diagnostics:profiler-session-refusal:unsupported",
  },
  semanticState: {
    kind: "profiler-session-refusal",
    anchor: "machinen-real-profiler-session-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-profiler-session-unsupported",
  refusalReason:
    "profiler session refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
