#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "192-memory-real-http2-session-refusal",
  rowDir: "portability/nodejs/192-memory-real-http2-session-refusal",
  kind: "machinen.nodejs-portability-memory-real-http2-session-refusal-smoke-report",
  shape: "http2-session",
  anchors: {
    anchor: "machinen-real-http2-session-refusal-anchor-v1",
    marker: "network-boundary:http2-session-refusal:unsupported",
  },
  semanticState: {
    kind: "http2-session-refusal",
    anchor: "machinen-real-http2-session-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-http2-session-unsupported",
  refusalReason:
    "http2 session refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
