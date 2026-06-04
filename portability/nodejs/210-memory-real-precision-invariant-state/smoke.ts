#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "210-memory-real-precision-invariant-state",
  rowDir: "portability/nodejs/210-memory-real-precision-invariant-state",
  kind: "machinen.nodejs-portability-memory-real-precision-invariant-state-smoke-report",
  shape: "precision-invariant-state",
  anchors: {
    anchor: "machinen-real-precision-invariant-state-anchor-v1",
    marker: "bigint-math:precision-invariant-state:unsupported",
  },
  semanticState: {
    kind: "precision-invariant-state",
    anchor: "machinen-real-precision-invariant-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-precision-invariant-unsupported",
  refusalReason:
    "precision invariant state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
