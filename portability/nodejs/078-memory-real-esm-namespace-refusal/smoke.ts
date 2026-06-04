#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "078-memory-real-esm-namespace-refusal",
  rowDir: "portability/nodejs/078-memory-real-esm-namespace-refusal",
  kind: "machinen.nodejs-portability-memory-real-esm-namespace-refusal-smoke-report",
  shape: "esm-namespace",
  anchors: {
    anchor: "machinen-real-esm-namespace-refusal-anchor-v1",
    marker: "module-state:esm-namespace-refusal:unsupported",
  },
  semanticState: {
    kind: "esm-namespace-refusal",
    anchor: "machinen-real-esm-namespace-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-esm-namespace-unsupported",
  refusalReason:
    "esm namespace refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
