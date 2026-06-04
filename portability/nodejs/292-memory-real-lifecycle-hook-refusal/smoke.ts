#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "292-memory-real-lifecycle-hook-refusal",
  rowDir: "portability/nodejs/292-memory-real-lifecycle-hook-refusal",
  kind: "machinen.nodejs-portability-memory-real-lifecycle-hook-refusal-smoke-report",
  shape: "lifecycle-hook",
  anchors: {
    anchor: "machinen-real-lifecycle-hook-refusal-anchor-v1",
    marker: "dependency-injection:lifecycle-hook-refusal:unsupported",
  },
  semanticState: {
    kind: "lifecycle-hook-refusal",
    anchor: "machinen-real-lifecycle-hook-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-lifecycle-hook-unsupported",
  refusalReason:
    "lifecycle hook refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
