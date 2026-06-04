#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "271-memory-real-cursor-refusal",
  rowDir: "portability/nodejs/271-memory-real-cursor-refusal",
  kind: "machinen.nodejs-portability-memory-real-cursor-refusal-smoke-report",
  shape: "cursor",
  anchors: {
    anchor: "machinen-real-cursor-refusal-anchor-v1",
    marker: "in-memory-db:cursor-refusal:unsupported",
  },
  semanticState: {
    kind: "cursor-refusal",
    anchor: "machinen-real-cursor-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-cursor-unsupported",
  refusalReason:
    "cursor refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
