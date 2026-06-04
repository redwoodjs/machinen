#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "182-memory-real-stdio-handle-refusal",
  rowDir: "portability/nodejs/182-memory-real-stdio-handle-refusal",
  kind: "machinen.nodejs-portability-memory-real-stdio-handle-refusal-smoke-report",
  shape: "stdio-handle",
  anchors: {
    anchor: "machinen-real-stdio-handle-refusal-anchor-v1",
    marker: "process-native-boundary:stdio-handle-refusal:unsupported",
  },
  semanticState: {
    kind: "stdio-handle-refusal",
    anchor: "machinen-real-stdio-handle-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-stdio-handle-unsupported",
  refusalReason:
    "stdio handle refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
