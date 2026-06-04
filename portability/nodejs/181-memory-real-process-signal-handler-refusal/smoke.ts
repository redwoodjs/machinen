#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "181-memory-real-process-signal-handler-refusal",
  rowDir: "portability/nodejs/181-memory-real-process-signal-handler-refusal",
  kind: "machinen.nodejs-portability-memory-real-process-signal-handler-refusal-smoke-report",
  shape: "process-signal-handler",
  anchors: {
    anchor: "machinen-real-process-signal-handler-refusal-anchor-v1",
    marker: "process-native-boundary:process-signal-handler-refusal:unsupported",
  },
  semanticState: {
    kind: "process-signal-handler-refusal",
    anchor: "machinen-real-process-signal-handler-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-process-signal-handler-unsupported",
  refusalReason:
    "process signal handler refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
