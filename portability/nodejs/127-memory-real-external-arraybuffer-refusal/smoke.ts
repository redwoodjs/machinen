#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "127-memory-real-external-arraybuffer-refusal",
  rowDir: "portability/nodejs/127-memory-real-external-arraybuffer-refusal",
  kind: "machinen.nodejs-portability-memory-real-external-arraybuffer-refusal-smoke-report",
  shape: "external-arraybuffer",
  anchors: {
    anchor: "machinen-real-external-arraybuffer-refusal-anchor-v1",
    marker: "buffer-advanced:external-arraybuffer-refusal:unsupported",
  },
  semanticState: {
    kind: "external-arraybuffer-refusal",
    anchor: "machinen-real-external-arraybuffer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-external-arraybuffer-unsupported",
  refusalReason:
    "external arraybuffer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
