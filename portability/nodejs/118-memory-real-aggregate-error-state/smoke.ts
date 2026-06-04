#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "118-memory-real-aggregate-error-state",
  rowDir: "portability/nodejs/118-memory-real-aggregate-error-state",
  kind: "machinen.nodejs-portability-memory-real-aggregate-error-state-smoke-report",
  shape: "aggregate-error-state",
  anchors: {
    anchor: "machinen-real-aggregate-error-state-anchor-v1",
    marker: "error-advanced:aggregate-error-state:unsupported",
  },
  semanticState: {
    kind: "aggregate-error-state",
    anchor: "machinen-real-aggregate-error-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-aggregate-error-unsupported",
  refusalReason:
    "aggregate error state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
