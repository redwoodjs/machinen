#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "299-memory-real-parser-mid-token-refusal",
  rowDir: "portability/nodejs/299-memory-real-parser-mid-token-refusal",
  kind: "machinen.nodejs-portability-memory-real-parser-mid-token-refusal-smoke-report",
  shape: "parser-mid-token",
  anchors: {
    anchor: "machinen-real-parser-mid-token-refusal-anchor-v1",
    marker: "parser-state:parser-mid-token-refusal:unsupported",
  },
  semanticState: {
    kind: "parser-mid-token-refusal",
    anchor: "machinen-real-parser-mid-token-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-parser-mid-token-unsupported",
  refusalReason:
    "parser mid token refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
