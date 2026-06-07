#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "134-memory-real-private-fields-refusal",
  rowDir: "portability/nodejs/134-memory-real-private-fields-refusal",
  kind: "machinen.nodejs-portability-memory-real-private-fields-refusal-smoke-report",
  shape: "private-fields",
  anchors: {
    anchor: "machinen-real-private-fields-refusal-anchor-v1",
    marker: "class-prototype:private-fields-refusal:unsupported",
  },
  semanticState: {
    kind: "private-fields-refusal",
    anchor: "machinen-real-private-fields-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-private-fields-unsupported",
  refusalReason:
    "private fields refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
