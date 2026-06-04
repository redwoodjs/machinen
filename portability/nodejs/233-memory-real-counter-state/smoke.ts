#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "233-memory-real-counter-state",
  rowDir: "portability/nodejs/233-memory-real-counter-state",
  kind: "machinen.nodejs-portability-memory-real-counter-state-smoke-report",
  shape: "counter-state",
  anchors: {
    anchor: "machinen-real-counter-state-anchor-v1",
    marker: "diagnostics:counter-state:unsupported",
  },
  semanticState: {
    kind: "counter-state",
    anchor: "machinen-real-counter-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-counter-unsupported",
  refusalReason:
    "counter state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
