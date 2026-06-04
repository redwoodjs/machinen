#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "245-memory-real-synthetic-module-refusal",
  rowDir: "portability/nodejs/245-memory-real-synthetic-module-refusal",
  kind: "machinen.nodejs-portability-memory-real-synthetic-module-refusal-smoke-report",
  shape: "synthetic-module",
  anchors: {
    anchor: "machinen-real-synthetic-module-refusal-anchor-v1",
    marker: "vm-module:synthetic-module-refusal:unsupported",
  },
  semanticState: {
    kind: "synthetic-module-refusal",
    anchor: "machinen-real-synthetic-module-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-synthetic-module-unsupported",
  refusalReason:
    "synthetic module refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
