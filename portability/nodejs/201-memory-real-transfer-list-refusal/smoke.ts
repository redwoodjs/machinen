#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "201-memory-real-transfer-list-refusal",
  rowDir: "portability/nodejs/201-memory-real-transfer-list-refusal",
  kind: "machinen.nodejs-portability-memory-real-transfer-list-refusal-smoke-report",
  shape: "transfer-list",
  anchors: {
    anchor: "machinen-real-transfer-list-refusal-anchor-v1",
    marker: "serialization:transfer-list-refusal:unsupported",
  },
  semanticState: {
    kind: "transfer-list-refusal",
    anchor: "machinen-real-transfer-list-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-transfer-list-unsupported",
  refusalReason:
    "transfer list refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
