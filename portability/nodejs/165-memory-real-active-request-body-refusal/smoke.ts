#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "165-memory-real-active-request-body-refusal",
  rowDir: "portability/nodejs/165-memory-real-active-request-body-refusal",
  kind: "machinen.nodejs-portability-memory-real-active-request-body-refusal-smoke-report",
  shape: "active-request-body",
  anchors: {
    anchor: "machinen-real-active-request-body-refusal-anchor-v1",
    marker: "http-app-state:active-request-body-refusal:unsupported",
  },
  semanticState: {
    kind: "active-request-body-refusal",
    anchor: "machinen-real-active-request-body-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-active-request-body-unsupported",
  refusalReason:
    "active request body refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
