#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "180-memory-real-ffi-handle-refusal",
  rowDir: "portability/nodejs/180-memory-real-ffi-handle-refusal",
  kind: "machinen.nodejs-portability-memory-real-ffi-handle-refusal-smoke-report",
  shape: "ffi-handle",
  anchors: {
    anchor: "machinen-real-ffi-handle-refusal-anchor-v1",
    marker: "process-native-boundary:ffi-handle-refusal:unsupported",
  },
  semanticState: {
    kind: "ffi-handle-refusal",
    anchor: "machinen-real-ffi-handle-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-ffi-handle-unsupported",
  refusalReason:
    "ffi handle refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
