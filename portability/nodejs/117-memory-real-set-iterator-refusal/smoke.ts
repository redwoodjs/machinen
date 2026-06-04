#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "117-memory-real-set-iterator-refusal",
  rowDir: "portability/nodejs/117-memory-real-set-iterator-refusal",
  kind: "machinen.nodejs-portability-memory-real-set-iterator-refusal-smoke-report",
  shape: "set-iterator",
  anchors: {
    anchor: "machinen-real-set-iterator-refusal-anchor-v1",
    marker: "collections-advanced:set-iterator-refusal:unsupported",
  },
  semanticState: {
    kind: "set-iterator-refusal",
    anchor: "machinen-real-set-iterator-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-set-iterator-unsupported",
  refusalReason:
    "set iterator refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
