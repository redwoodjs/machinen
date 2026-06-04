#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "095-memory-real-keyobject-refusal",
  rowDir: "portability/nodejs/095-memory-real-keyobject-refusal",
  kind: "machinen.nodejs-portability-memory-real-keyobject-refusal-smoke-report",
  shape: "keyobject",
  anchors: {
    anchor: "machinen-real-keyobject-refusal-anchor-v1",
    marker: "crypto-memory:keyobject-refusal:unsupported",
  },
  semanticState: {
    kind: "keyobject-refusal",
    anchor: "machinen-real-keyobject-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-keyobject-unsupported",
  refusalReason:
    "keyobject refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
