#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "229-memory-real-stream-backed-logger-refusal",
  rowDir: "portability/nodejs/229-memory-real-stream-backed-logger-refusal",
  kind: "machinen.nodejs-portability-memory-real-stream-backed-logger-refusal-smoke-report",
  shape: "stream-backed-logger",
  anchors: {
    anchor: "machinen-real-stream-backed-logger-refusal-anchor-v1",
    marker: "console-logging:stream-backed-logger-refusal:unsupported",
  },
  semanticState: {
    kind: "stream-backed-logger-refusal",
    anchor: "machinen-real-stream-backed-logger-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-stream-backed-logger-unsupported",
  refusalReason:
    "stream backed logger refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
