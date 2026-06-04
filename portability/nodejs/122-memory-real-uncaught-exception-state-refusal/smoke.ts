#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "122-memory-real-uncaught-exception-state-refusal",
  rowDir: "portability/nodejs/122-memory-real-uncaught-exception-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-uncaught-exception-state-refusal-smoke-report",
  shape: "uncaught-exception-state",
  anchors: {
    anchor: "machinen-real-uncaught-exception-state-refusal-anchor-v1",
    marker: "error-advanced:uncaught-exception-state-refusal:unsupported",
  },
  semanticState: {
    kind: "uncaught-exception-state-refusal",
    anchor: "machinen-real-uncaught-exception-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-uncaught-exception-unsupported",
  refusalReason:
    "uncaught exception state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
