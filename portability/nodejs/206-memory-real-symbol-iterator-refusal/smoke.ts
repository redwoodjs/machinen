#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "206-memory-real-symbol-iterator-refusal",
  rowDir: "portability/nodejs/206-memory-real-symbol-iterator-refusal",
  kind: "machinen.nodejs-portability-memory-real-symbol-iterator-refusal-smoke-report",
  shape: "symbol-iterator",
  anchors: {
    anchor: "machinen-real-symbol-iterator-refusal-anchor-v1",
    marker: "symbol-detail:symbol-iterator-refusal:unsupported",
  },
  semanticState: {
    kind: "symbol-iterator-refusal",
    anchor: "machinen-real-symbol-iterator-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-symbol-iterator-unsupported",
  refusalReason:
    "symbol iterator refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
