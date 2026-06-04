#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "077-memory-real-ephemeron-table-refusal",
  rowDir: "portability/nodejs/077-memory-real-ephemeron-table-refusal",
  kind: "machinen.nodejs-portability-memory-real-ephemeron-table-refusal-smoke-report",
  shape: "ephemeron-table",
  anchors: {
    anchor: "machinen-real-ephemeron-table-refusal-anchor-v1",
    marker: "weak-gc-state:ephemeron-table-refusal:unsupported",
  },
  semanticState: {
    kind: "ephemeron-table-refusal",
    anchor: "machinen-real-ephemeron-table-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-ephemeron-table-unsupported",
  refusalReason:
    "ephemeron table refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
