#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "105-memory-real-response-refusal",
  rowDir: "portability/nodejs/105-memory-real-response-refusal",
  kind: "machinen.nodejs-portability-memory-real-response-refusal-smoke-report",
  shape: "response",
  anchors: {
    anchor: "machinen-real-response-refusal-anchor-v1",
    marker: "web-api-state:response-refusal:unsupported",
  },
  semanticState: {
    kind: "response-refusal",
    anchor: "machinen-real-response-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-response-unsupported",
  refusalReason:
    "response refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
