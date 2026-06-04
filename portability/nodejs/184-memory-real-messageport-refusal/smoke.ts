#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "184-memory-real-messageport-refusal",
  rowDir: "portability/nodejs/184-memory-real-messageport-refusal",
  kind: "machinen.nodejs-portability-memory-real-messageport-refusal-smoke-report",
  shape: "messageport",
  anchors: {
    anchor: "machinen-real-messageport-refusal-anchor-v1",
    marker: "worker-boundary:messageport-refusal:unsupported",
  },
  semanticState: {
    kind: "messageport-refusal",
    anchor: "machinen-real-messageport-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-messageport-unsupported",
  refusalReason:
    "messageport refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
