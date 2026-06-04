#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "202-memory-real-serializer-replacer-refusal",
  rowDir: "portability/nodejs/202-memory-real-serializer-replacer-refusal",
  kind: "machinen.nodejs-portability-memory-real-serializer-replacer-refusal-smoke-report",
  shape: "serializer-replacer",
  anchors: {
    anchor: "machinen-real-serializer-replacer-refusal-anchor-v1",
    marker: "serialization:serializer-replacer-refusal:unsupported",
  },
  semanticState: {
    kind: "serializer-replacer-refusal",
    anchor: "machinen-real-serializer-replacer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-serializer-replacer-unsupported",
  refusalReason:
    "serializer replacer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
