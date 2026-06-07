#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "307-memory-real-sensitive-buffer-refusal",
  rowDir: "portability/nodejs/307-memory-real-sensitive-buffer-refusal",
  kind: "machinen.nodejs-portability-memory-real-sensitive-buffer-refusal-smoke-report",
  shape: "sensitive-buffer",
  anchors: {
    anchor: "machinen-real-sensitive-buffer-refusal-anchor-v1",
    marker: "security-sensitive:sensitive-buffer-refusal:unsupported",
  },
  semanticState: {
    kind: "sensitive-buffer-refusal",
    anchor: "machinen-real-sensitive-buffer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-sensitive-buffer-unsupported",
  refusalReason:
    "sensitive buffer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
