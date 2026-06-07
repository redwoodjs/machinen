#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "251-memory-real-wasm-table-refusal",
  rowDir: "portability/nodejs/251-memory-real-wasm-table-refusal",
  kind: "machinen.nodejs-portability-memory-real-wasm-table-refusal-smoke-report",
  shape: "wasm-table",
  anchors: {
    anchor: "machinen-real-wasm-table-refusal-anchor-v1",
    marker: "wasm:wasm-table-refusal:unsupported",
  },
  semanticState: {
    kind: "wasm-table-refusal",
    anchor: "machinen-real-wasm-table-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-wasm-table-unsupported",
  refusalReason:
    "wasm table refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
