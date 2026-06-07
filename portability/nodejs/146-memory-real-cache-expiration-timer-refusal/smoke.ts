#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "146-memory-real-cache-expiration-timer-refusal",
  rowDir: "portability/nodejs/146-memory-real-cache-expiration-timer-refusal",
  kind: "machinen.nodejs-portability-memory-real-cache-expiration-timer-refusal-smoke-report",
  shape: "cache-expiration-timer",
  anchors: {
    anchor: "machinen-real-cache-expiration-timer-refusal-anchor-v1",
    marker: "cache-policy:cache-expiration-timer-refusal:unsupported",
  },
  semanticState: {
    kind: "cache-expiration-timer-refusal",
    anchor: "machinen-real-cache-expiration-timer-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-cache-expiration-timer-unsupported",
  refusalReason:
    "cache expiration timer refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
