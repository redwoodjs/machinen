#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "094-memory-real-hmac-state-refusal",
  rowDir: "portability/nodejs/094-memory-real-hmac-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-hmac-state-refusal-smoke-report",
  shape: "hmac-state",
  anchors: {
    anchor: "machinen-real-hmac-state-refusal-anchor-v1",
    marker: "crypto-memory:hmac-state-refusal:unsupported",
  },
  semanticState: {
    kind: "hmac-state-refusal",
    anchor: "machinen-real-hmac-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-hmac-unsupported",
  refusalReason:
    "hmac state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
