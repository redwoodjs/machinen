#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "102-memory-real-arraybuffer-transfer-refusal",
  rowDir: "portability/nodejs/102-memory-real-arraybuffer-transfer-refusal",
  kind: "machinen.nodejs-portability-memory-real-arraybuffer-transfer-refusal-smoke-report",
  shape: "arraybuffer-transfer",
  anchors: {
    anchor: "machinen-real-arraybuffer-transfer-refusal-anchor-v1",
    marker: "text-data:arraybuffer-transfer-refusal:unsupported",
  },
  semanticState: {
    kind: "arraybuffer-transfer-refusal",
    anchor: "machinen-real-arraybuffer-transfer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-arraybuffer-transfer-unsupported",
  refusalReason:
    "arraybuffer transfer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
