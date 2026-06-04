#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "296-memory-real-render-context-refusal",
  rowDir: "portability/nodejs/296-memory-real-render-context-refusal",
  kind: "machinen.nodejs-portability-memory-real-render-context-refusal-smoke-report",
  shape: "render-context",
  anchors: {
    anchor: "machinen-real-render-context-refusal-anchor-v1",
    marker: "template-render:render-context-refusal:unsupported",
  },
  semanticState: {
    kind: "render-context-refusal",
    anchor: "machinen-real-render-context-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-render-context-unsupported",
  refusalReason:
    "render context refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
