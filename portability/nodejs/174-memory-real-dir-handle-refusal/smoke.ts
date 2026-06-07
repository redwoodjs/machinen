#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "174-memory-real-dir-handle-refusal",
  rowDir: "portability/nodejs/174-memory-real-dir-handle-refusal",
  kind: "machinen.nodejs-portability-memory-real-dir-handle-refusal-smoke-report",
  shape: "dir-handle",
  anchors: {
    anchor: "machinen-real-dir-handle-refusal-anchor-v1",
    marker: "filesystem-handles:dir-handle-refusal:unsupported",
  },
  semanticState: {
    kind: "dir-handle-refusal",
    anchor: "machinen-real-dir-handle-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-dir-handle-unsupported",
  refusalReason:
    "dir handle refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
