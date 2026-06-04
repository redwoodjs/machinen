#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "228-memory-real-buffered-logger-state",
  rowDir: "portability/nodejs/228-memory-real-buffered-logger-state",
  kind: "machinen.nodejs-portability-memory-real-buffered-logger-state-smoke-report",
  shape: "buffered-logger-state",
  anchors: {
    anchor: "machinen-real-buffered-logger-state-anchor-v1",
    marker: "console-logging:buffered-logger-state:unsupported",
  },
  semanticState: {
    kind: "buffered-logger-state",
    anchor: "machinen-real-buffered-logger-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-buffered-logger-unsupported",
  refusalReason:
    "buffered logger state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
