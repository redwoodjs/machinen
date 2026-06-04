#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "079-memory-real-commonjs-cache-state",
  rowDir: "portability/nodejs/079-memory-real-commonjs-cache-state",
  kind: "machinen.nodejs-portability-memory-real-commonjs-cache-state-smoke-report",
  shape: "commonjs-cache-state",
  anchors: {
    anchor: "machinen-real-commonjs-cache-state-anchor-v1",
    marker: "module-state:commonjs-cache-state:unsupported",
  },
  semanticState: {
    kind: "commonjs-cache-state",
    anchor: "machinen-real-commonjs-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-commonjs-cache-unsupported",
  refusalReason:
    "commonjs cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
