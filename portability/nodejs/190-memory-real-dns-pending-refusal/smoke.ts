#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "190-memory-real-dns-pending-refusal",
  rowDir: "portability/nodejs/190-memory-real-dns-pending-refusal",
  kind: "machinen.nodejs-portability-memory-real-dns-pending-refusal-smoke-report",
  shape: "dns-pending",
  anchors: {
    anchor: "machinen-real-dns-pending-refusal-anchor-v1",
    marker: "network-boundary:dns-pending-refusal:unsupported",
  },
  semanticState: {
    kind: "dns-pending-refusal",
    anchor: "machinen-real-dns-pending-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-dns-pending-unsupported",
  refusalReason:
    "dns pending refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
