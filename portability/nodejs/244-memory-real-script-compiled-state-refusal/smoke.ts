#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "244-memory-real-script-compiled-state-refusal",
  rowDir: "portability/nodejs/244-memory-real-script-compiled-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-script-compiled-state-refusal-smoke-report",
  shape: "script-compiled-state",
  anchors: {
    anchor: "machinen-real-script-compiled-state-refusal-anchor-v1",
    marker: "vm-module:script-compiled-state-refusal:unsupported",
  },
  semanticState: {
    kind: "script-compiled-state-refusal",
    anchor: "machinen-real-script-compiled-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-script-compiled-unsupported",
  refusalReason:
    "script compiled state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
