#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "189-memory-real-tls-socket-refusal",
  rowDir: "portability/nodejs/189-memory-real-tls-socket-refusal",
  kind: "machinen.nodejs-portability-memory-real-tls-socket-refusal-smoke-report",
  shape: "tls-socket",
  anchors: {
    anchor: "machinen-real-tls-socket-refusal-anchor-v1",
    marker: "network-boundary:tls-socket-refusal:unsupported",
  },
  semanticState: {
    kind: "tls-socket-refusal",
    anchor: "machinen-real-tls-socket-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-tls-socket-unsupported",
  refusalReason:
    "tls socket refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
