#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "220-memory-real-temporal-object-refusal",
  rowDir: "portability/nodejs/220-memory-real-temporal-object-refusal",
  kind: "machinen.nodejs-portability-memory-real-temporal-object-refusal-smoke-report",
  shape: "temporal-object",
  anchors: {
    anchor: "machinen-real-temporal-object-refusal-anchor-v1",
    marker: "date-time:temporal-object-refusal:unsupported",
  },
  semanticState: {
    kind: "temporal-object-refusal",
    anchor: "machinen-real-temporal-object-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-temporal-object-unsupported",
  refusalReason:
    "temporal object refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
