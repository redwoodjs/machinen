#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "125-memory-real-buffer-pool-refusal",
  rowDir: "portability/nodejs/125-memory-real-buffer-pool-refusal",
  kind: "machinen.nodejs-portability-memory-real-buffer-pool-refusal-smoke-report",
  shape: "buffer-pool",
  anchors: {
    anchor: "machinen-real-buffer-pool-refusal-anchor-v1",
    marker: "buffer-advanced:buffer-pool-refusal:unsupported",
  },
  semanticState: {
    kind: "buffer-pool-refusal",
    anchor: "machinen-real-buffer-pool-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-buffer-pool-unsupported",
  refusalReason:
    "buffer pool refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
