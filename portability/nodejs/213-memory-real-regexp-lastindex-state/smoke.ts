#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "213-memory-real-regexp-lastindex-state",
  rowDir: "portability/nodejs/213-memory-real-regexp-lastindex-state",
  kind: "machinen.nodejs-portability-memory-real-regexp-lastindex-state-smoke-report",
  shape: "regexp-lastindex-state",
  anchors: {
    anchor: "machinen-real-regexp-lastindex-state-anchor-v1",
    marker: "regexp-detail:regexp-lastindex-state:unsupported",
  },
  semanticState: {
    kind: "regexp-lastindex-state",
    anchor: "machinen-real-regexp-lastindex-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-regexp-lastindex-unsupported",
  refusalReason:
    "regexp lastindex state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
