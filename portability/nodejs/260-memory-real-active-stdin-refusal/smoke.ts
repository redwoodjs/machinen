#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "260-memory-real-active-stdin-refusal",
  rowDir: "portability/nodejs/260-memory-real-active-stdin-refusal",
  kind: "machinen.nodejs-portability-memory-real-active-stdin-refusal-smoke-report",
  shape: "active-stdin",
  anchors: {
    anchor: "machinen-real-active-stdin-refusal-anchor-v1",
    marker: "cli-app-state:active-stdin-refusal:unsupported",
  },
  semanticState: {
    kind: "active-stdin-refusal",
    anchor: "machinen-real-active-stdin-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-active-stdin-unsupported",
  refusalReason:
    "active stdin refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
