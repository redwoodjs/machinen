#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "302-memory-real-incremental-parser-refusal",
  rowDir: "portability/nodejs/302-memory-real-incremental-parser-refusal",
  kind: "machinen.nodejs-portability-memory-real-incremental-parser-refusal-smoke-report",
  shape: "incremental-parser",
  anchors: {
    anchor: "machinen-real-incremental-parser-refusal-anchor-v1",
    marker: "parser-state:incremental-parser-refusal:unsupported",
  },
  semanticState: {
    kind: "incremental-parser-refusal",
    anchor: "machinen-real-incremental-parser-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-incremental-parser-unsupported",
  refusalReason:
    "incremental parser refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
