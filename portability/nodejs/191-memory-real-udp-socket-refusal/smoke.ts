#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "191-memory-real-udp-socket-refusal",
  rowDir: "portability/nodejs/191-memory-real-udp-socket-refusal",
  kind: "machinen.nodejs-portability-memory-real-udp-socket-refusal-smoke-report",
  shape: "udp-socket",
  anchors: {
    anchor: "machinen-real-udp-socket-refusal-anchor-v1",
    marker: "network-boundary:udp-socket-refusal:unsupported",
  },
  semanticState: {
    kind: "udp-socket-refusal",
    anchor: "machinen-real-udp-socket-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-udp-socket-unsupported",
  refusalReason:
    "udp socket refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
