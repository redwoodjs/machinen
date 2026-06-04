#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "068-memory-real-proxy-refusal",
  rowDir: "portability/nodejs/068-memory-real-proxy-refusal",
  kind: "machinen.nodejs-portability-memory-real-proxy-refusal-smoke-report",
  shape: "proxy",
  anchors: {
    anchor: "machinen-real-proxy-refusal-anchor-v1",
    marker: "object-mechanics:proxy-refusal:unsupported",
  },
  semanticState: {
    kind: "proxy-refusal",
    anchor: "machinen-real-proxy-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-proxy-unsupported",
  refusalReason:
    "proxy refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
