#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "104-memory-real-request-refusal",
  rowDir: "portability/nodejs/104-memory-real-request-refusal",
  kind: "machinen.nodejs-portability-memory-real-request-refusal-smoke-report",
  shape: "request",
  anchors: {
    anchor: "machinen-real-request-refusal-anchor-v1",
    marker: "web-api-state:request-refusal:unsupported",
  },
  semanticState: {
    kind: "request-refusal",
    anchor: "machinen-real-request-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-request-unsupported",
  refusalReason:
    "request refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
