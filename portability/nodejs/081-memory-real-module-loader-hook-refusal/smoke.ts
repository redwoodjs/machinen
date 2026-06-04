#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "081-memory-real-module-loader-hook-refusal",
  rowDir: "portability/nodejs/081-memory-real-module-loader-hook-refusal",
  kind: "machinen.nodejs-portability-memory-real-module-loader-hook-refusal-smoke-report",
  shape: "module-loader-hook",
  anchors: {
    anchor: "machinen-real-module-loader-hook-refusal-anchor-v1",
    marker: "module-state:module-loader-hook-refusal:unsupported",
  },
  semanticState: {
    kind: "module-loader-hook-refusal",
    anchor: "machinen-real-module-loader-hook-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-module-loader-hook-unsupported",
  refusalReason:
    "module loader hook refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
