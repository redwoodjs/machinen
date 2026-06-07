#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "235-memory-real-active-inspector-refusal",
  rowDir: "portability/nodejs/235-memory-real-active-inspector-refusal",
  kind: "machinen.nodejs-portability-memory-real-active-inspector-refusal-smoke-report",
  shape: "active-inspector",
  anchors: {
    anchor: "machinen-real-active-inspector-refusal-anchor-v1",
    marker: "diagnostics:active-inspector-refusal:unsupported",
  },
  semanticState: {
    kind: "active-inspector-refusal",
    anchor: "machinen-real-active-inspector-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-active-inspector-unsupported",
  refusalReason:
    "active inspector refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
