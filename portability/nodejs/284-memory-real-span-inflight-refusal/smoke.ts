#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "284-memory-real-span-inflight-refusal",
  rowDir: "portability/nodejs/284-memory-real-span-inflight-refusal",
  kind: "machinen.nodejs-portability-memory-real-span-inflight-refusal-smoke-report",
  shape: "span-inflight",
  anchors: {
    anchor: "machinen-real-span-inflight-refusal-anchor-v1",
    marker: "observability:span-inflight-refusal:unsupported",
  },
  semanticState: {
    kind: "span-inflight-refusal",
    anchor: "machinen-real-span-inflight-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-span-inflight-unsupported",
  refusalReason:
    "span inflight refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
