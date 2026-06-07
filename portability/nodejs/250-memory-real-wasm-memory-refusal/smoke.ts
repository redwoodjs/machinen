#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "250-memory-real-wasm-memory-refusal",
  rowDir: "portability/nodejs/250-memory-real-wasm-memory-refusal",
  kind: "machinen.nodejs-portability-memory-real-wasm-memory-refusal-smoke-report",
  shape: "wasm-memory",
  anchors: {
    anchor: "machinen-real-wasm-memory-refusal-anchor-v1",
    marker: "wasm:wasm-memory-refusal:unsupported",
  },
  semanticState: {
    kind: "wasm-memory-refusal",
    anchor: "machinen-real-wasm-memory-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-wasm-memory-unsupported",
  refusalReason:
    "wasm memory refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
