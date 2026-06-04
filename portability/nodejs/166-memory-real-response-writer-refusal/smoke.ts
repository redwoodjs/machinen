#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "166-memory-real-response-writer-refusal",
  rowDir: "portability/nodejs/166-memory-real-response-writer-refusal",
  kind: "machinen.nodejs-portability-memory-real-response-writer-refusal-smoke-report",
  shape: "response-writer",
  anchors: {
    anchor: "machinen-real-response-writer-refusal-anchor-v1",
    marker: "http-app-state:response-writer-refusal:unsupported",
  },
  semanticState: {
    kind: "response-writer-refusal",
    anchor: "machinen-real-response-writer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-response-writer-unsupported",
  refusalReason:
    "response writer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
