#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "310-memory-real-unclassified-state-refusal",
  rowDir: "portability/nodejs/310-memory-real-unclassified-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-unclassified-state-refusal-smoke-report",
  shape: "unclassified-state",
  anchors: {
    anchor: "machinen-real-unclassified-state-refusal-anchor-v1",
    marker: "unknown-opaque-hardening:unclassified-state-refusal:unsupported",
  },
  semanticState: {
    kind: "unclassified-state-refusal",
    anchor: "machinen-real-unclassified-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-unclassified-unsupported",
  refusalReason:
    "unclassified state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
