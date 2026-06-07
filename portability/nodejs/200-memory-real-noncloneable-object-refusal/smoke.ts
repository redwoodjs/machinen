#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "200-memory-real-noncloneable-object-refusal",
  rowDir: "portability/nodejs/200-memory-real-noncloneable-object-refusal",
  kind: "machinen.nodejs-portability-memory-real-noncloneable-object-refusal-smoke-report",
  shape: "noncloneable-object",
  anchors: {
    anchor: "machinen-real-noncloneable-object-refusal-anchor-v1",
    marker: "serialization:noncloneable-object-refusal:unsupported",
  },
  semanticState: {
    kind: "noncloneable-object-refusal",
    anchor: "machinen-real-noncloneable-object-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-noncloneable-object-unsupported",
  refusalReason:
    "noncloneable object refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
