#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "065-memory-real-async-local-storage-refusal",
  rowDir: "portability/nodejs/065-memory-real-async-local-storage-refusal",
  kind: "machinen.nodejs-portability-memory-real-async-local-storage-refusal-smoke-report",
  shape: "async-local-storage",
  anchors: {
    anchor: "machinen-real-async-local-storage-refusal-anchor-v1",
    marker: "async-context:async-local-storage-refusal:unsupported",
  },
  semanticState: {
    kind: "async-local-storage-refusal",
    anchor: "machinen-real-async-local-storage-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-async-local-storage-unsupported",
  refusalReason:
    "async local storage refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
