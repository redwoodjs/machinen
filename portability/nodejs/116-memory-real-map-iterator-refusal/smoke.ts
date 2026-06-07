#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "116-memory-real-map-iterator-refusal",
  rowDir: "portability/nodejs/116-memory-real-map-iterator-refusal",
  kind: "machinen.nodejs-portability-memory-real-map-iterator-refusal-smoke-report",
  shape: "map-iterator",
  anchors: {
    anchor: "machinen-real-map-iterator-refusal-anchor-v1",
    marker: "collections-advanced:map-iterator-refusal:unsupported",
  },
  semanticState: {
    kind: "map-iterator-refusal",
    anchor: "machinen-real-map-iterator-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-map-iterator-unsupported",
  refusalReason:
    "map iterator refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
