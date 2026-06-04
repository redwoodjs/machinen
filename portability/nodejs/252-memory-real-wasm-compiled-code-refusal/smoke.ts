#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "252-memory-real-wasm-compiled-code-refusal",
  rowDir: "portability/nodejs/252-memory-real-wasm-compiled-code-refusal",
  kind: "machinen.nodejs-portability-memory-real-wasm-compiled-code-refusal-smoke-report",
  shape: "wasm-compiled-code",
  anchors: {
    anchor: "machinen-real-wasm-compiled-code-refusal-anchor-v1",
    marker: "wasm:wasm-compiled-code-refusal:unsupported",
  },
  semanticState: {
    kind: "wasm-compiled-code-refusal",
    anchor: "machinen-real-wasm-compiled-code-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-wasm-compiled-code-unsupported",
  refusalReason:
    "wasm compiled code refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
