#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "282-memory-real-distributed-rate-limit-refusal",
  rowDir: "portability/nodejs/282-memory-real-distributed-rate-limit-refusal",
  kind: "machinen.nodejs-portability-memory-real-distributed-rate-limit-refusal-smoke-report",
  shape: "distributed-rate-limit",
  anchors: {
    anchor: "machinen-real-distributed-rate-limit-refusal-anchor-v1",
    marker: "rate-limiting:distributed-rate-limit-refusal:unsupported",
  },
  semanticState: {
    kind: "distributed-rate-limit-refusal",
    anchor: "machinen-real-distributed-rate-limit-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-distributed-rate-limit-unsupported",
  refusalReason:
    "distributed rate limit refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
