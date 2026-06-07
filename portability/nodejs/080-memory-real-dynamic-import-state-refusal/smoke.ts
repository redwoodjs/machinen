#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "080-memory-real-dynamic-import-state-refusal",
  rowDir: "portability/nodejs/080-memory-real-dynamic-import-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-dynamic-import-state-refusal-smoke-report",
  shape: "dynamic-import-state",
  anchors: {
    anchor: "machinen-real-dynamic-import-state-refusal-anchor-v1",
    marker: "module-state:dynamic-import-state-refusal:unsupported",
  },
  semanticState: {
    kind: "dynamic-import-state-refusal",
    anchor: "machinen-real-dynamic-import-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-dynamic-import-unsupported",
  refusalReason:
    "dynamic import state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
