#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "216-memory-real-regexp-match-iterator-refusal",
  rowDir: "portability/nodejs/216-memory-real-regexp-match-iterator-refusal",
  kind: "machinen.nodejs-portability-memory-real-regexp-match-iterator-refusal-smoke-report",
  shape: "regexp-match-iterator",
  anchors: {
    anchor: "machinen-real-regexp-match-iterator-refusal-anchor-v1",
    marker: "regexp-detail:regexp-match-iterator-refusal:unsupported",
  },
  semanticState: {
    kind: "regexp-match-iterator-refusal",
    anchor: "machinen-real-regexp-match-iterator-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-regexp-match-iterator-unsupported",
  refusalReason:
    "regexp match iterator refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
