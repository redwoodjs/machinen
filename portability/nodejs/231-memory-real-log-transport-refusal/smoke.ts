#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "231-memory-real-log-transport-refusal",
  rowDir: "portability/nodejs/231-memory-real-log-transport-refusal",
  kind: "machinen.nodejs-portability-memory-real-log-transport-refusal-smoke-report",
  shape: "log-transport",
  anchors: {
    anchor: "machinen-real-log-transport-refusal-anchor-v1",
    marker: "console-logging:log-transport-refusal:unsupported",
  },
  semanticState: {
    kind: "log-transport-refusal",
    anchor: "machinen-real-log-transport-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-log-transport-unsupported",
  refusalReason:
    "log transport refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
