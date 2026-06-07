#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "062-memory-real-stream-refusal",
  rowDir: "portability/nodejs/062-memory-real-stream-refusal",
  kind: "machinen.nodejs-portability-memory-real-stream-refusal-smoke-report",
  shape: "stream",
  anchors: {
    anchor: "machinen-real-stream-refusal-anchor-v1",
    stream: "stream:buffered-native-state",
  },
  semanticState: {
    kind: "stream",
    anchor: "machinen-real-stream-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-stream-unsupported",
  refusalReason: "stream buffers and native backpressure state are refused until separately proven",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
