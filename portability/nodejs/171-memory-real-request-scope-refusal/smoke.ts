#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "171-memory-real-request-scope-refusal",
  rowDir: "portability/nodejs/171-memory-real-request-scope-refusal",
  kind: "machinen.nodejs-portability-memory-real-request-scope-refusal-smoke-report",
  shape: "request-scope",
  anchors: {
    anchor: "machinen-real-request-scope-refusal-anchor-v1",
    marker: "framework-state:request-scope-refusal:unsupported",
  },
  semanticState: {
    kind: "request-scope-refusal",
    anchor: "machinen-real-request-scope-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-request-scope-unsupported",
  refusalReason:
    "request scope refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
