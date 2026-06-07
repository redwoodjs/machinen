#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "187-memory-real-worker-shared-buffer-refusal",
  rowDir: "portability/nodejs/187-memory-real-worker-shared-buffer-refusal",
  kind: "machinen.nodejs-portability-memory-real-worker-shared-buffer-refusal-smoke-report",
  shape: "worker-shared-buffer",
  anchors: {
    anchor: "machinen-real-worker-shared-buffer-refusal-anchor-v1",
    marker: "worker-boundary:worker-shared-buffer-refusal:unsupported",
  },
  semanticState: {
    kind: "worker-shared-buffer-refusal",
    anchor: "machinen-real-worker-shared-buffer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-worker-shared-buffer-unsupported",
  refusalReason:
    "worker shared buffer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
