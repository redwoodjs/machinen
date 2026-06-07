#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "188-memory-real-tcp-socket-refusal",
  rowDir: "portability/nodejs/188-memory-real-tcp-socket-refusal",
  kind: "machinen.nodejs-portability-memory-real-tcp-socket-refusal-smoke-report",
  shape: "tcp-socket",
  anchors: {
    anchor: "machinen-real-tcp-socket-refusal-anchor-v1",
    marker: "network-boundary:tcp-socket-refusal:unsupported",
  },
  semanticState: {
    kind: "tcp-socket-refusal",
    anchor: "machinen-real-tcp-socket-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-tcp-socket-unsupported",
  refusalReason:
    "tcp socket refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
