#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "074-memory-real-finalization-registry-refusal",
  rowDir: "portability/nodejs/074-memory-real-finalization-registry-refusal",
  kind: "machinen.nodejs-portability-memory-real-finalization-registry-refusal-smoke-report",
  shape: "finalization-registry",
  anchors: {
    anchor: "machinen-real-finalization-registry-refusal-anchor-v1",
    marker: "weak-gc-state:finalization-registry-refusal:unsupported",
  },
  semanticState: {
    kind: "finalization-registry-refusal",
    anchor: "machinen-real-finalization-registry-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-finalization-registry-unsupported",
  refusalReason:
    "finalization registry refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
