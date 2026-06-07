#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "172-memory-real-framework-plugin-refusal",
  rowDir: "portability/nodejs/172-memory-real-framework-plugin-refusal",
  kind: "machinen.nodejs-portability-memory-real-framework-plugin-refusal-smoke-report",
  shape: "framework-plugin",
  anchors: {
    anchor: "machinen-real-framework-plugin-refusal-anchor-v1",
    marker: "framework-state:framework-plugin-refusal:unsupported",
  },
  semanticState: {
    kind: "framework-plugin-refusal",
    anchor: "machinen-real-framework-plugin-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-framework-plugin-unsupported",
  refusalReason:
    "framework plugin refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
