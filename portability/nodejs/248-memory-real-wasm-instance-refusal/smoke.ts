#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "248-memory-real-wasm-instance-refusal",
  rowDir: "portability/nodejs/248-memory-real-wasm-instance-refusal",
  kind: "machinen.nodejs-portability-memory-real-wasm-instance-refusal-smoke-report",
  shape: "wasm-instance",
  anchors: {
    anchor: "machinen-real-wasm-instance-refusal-anchor-v1",
    marker: "wasm:wasm-instance-refusal:unsupported",
  },
  semanticState: {
    kind: "wasm-instance-refusal",
    anchor: "machinen-real-wasm-instance-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-wasm-instance-unsupported",
  refusalReason:
    "wasm instance refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
