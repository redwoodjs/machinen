#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "272-memory-real-write-ahead-buffer-refusal",
  rowDir: "portability/nodejs/272-memory-real-write-ahead-buffer-refusal",
  kind: "machinen.nodejs-portability-memory-real-write-ahead-buffer-refusal-smoke-report",
  shape: "write-ahead-buffer",
  anchors: {
    anchor: "machinen-real-write-ahead-buffer-refusal-anchor-v1",
    marker: "in-memory-db:write-ahead-buffer-refusal:unsupported",
  },
  semanticState: {
    kind: "write-ahead-buffer-refusal",
    anchor: "machinen-real-write-ahead-buffer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-write-ahead-buffer-unsupported",
  refusalReason:
    "write ahead buffer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
