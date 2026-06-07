#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "126-memory-real-unsafe-buffer-refusal",
  rowDir: "portability/nodejs/126-memory-real-unsafe-buffer-refusal",
  kind: "machinen.nodejs-portability-memory-real-unsafe-buffer-refusal-smoke-report",
  shape: "unsafe-buffer",
  anchors: {
    anchor: "machinen-real-unsafe-buffer-refusal-anchor-v1",
    marker: "buffer-advanced:unsafe-buffer-refusal:unsupported",
  },
  semanticState: {
    kind: "unsafe-buffer-refusal",
    anchor: "machinen-real-unsafe-buffer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-unsafe-buffer-unsupported",
  refusalReason:
    "unsafe buffer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
