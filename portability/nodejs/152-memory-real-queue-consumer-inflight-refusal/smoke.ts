#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "152-memory-real-queue-consumer-inflight-refusal",
  rowDir: "portability/nodejs/152-memory-real-queue-consumer-inflight-refusal",
  kind: "machinen.nodejs-portability-memory-real-queue-consumer-inflight-refusal-smoke-report",
  shape: "queue-consumer-inflight",
  anchors: {
    anchor: "machinen-real-queue-consumer-inflight-refusal-anchor-v1",
    marker: "queue-policy:queue-consumer-inflight-refusal:unsupported",
  },
  semanticState: {
    kind: "queue-consumer-inflight-refusal",
    anchor: "machinen-real-queue-consumer-inflight-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-queue-consumer-inflight-unsupported",
  refusalReason:
    "queue consumer inflight refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
