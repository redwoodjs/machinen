#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "249-memory-real-wasm-module-bytes-state",
  rowDir: "portability/nodejs/249-memory-real-wasm-module-bytes-state",
  kind: "machinen.nodejs-portability-memory-real-wasm-module-bytes-state-smoke-report",
  shape: "wasm-module-bytes-state",
  anchors: {
    anchor: "machinen-real-wasm-module-bytes-state-anchor-v1",
    marker: "wasm:wasm-module-bytes-state:unsupported",
  },
  semanticState: {
    kind: "wasm-module-bytes-state",
    anchor: "machinen-real-wasm-module-bytes-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-wasm-module-bytes-unsupported",
  refusalReason:
    "wasm module bytes state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
