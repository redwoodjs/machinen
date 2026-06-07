#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "114-memory-real-object-keyed-map-refusal",
  rowDir: "portability/nodejs/114-memory-real-object-keyed-map-refusal",
  kind: "machinen.nodejs-portability-memory-real-object-keyed-map-refusal-smoke-report",
  shape: "object-keyed-map",
  anchors: {
    anchor: "machinen-real-object-keyed-map-refusal-anchor-v1",
    marker: "collections-advanced:object-keyed-map-refusal:unsupported",
  },
  semanticState: {
    kind: "object-keyed-map-refusal",
    anchor: "machinen-real-object-keyed-map-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-object-keyed-map-unsupported",
  refusalReason:
    "object keyed map refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
