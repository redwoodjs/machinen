#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "185-memory-real-broadcastchannel-refusal",
  rowDir: "portability/nodejs/185-memory-real-broadcastchannel-refusal",
  kind: "machinen.nodejs-portability-memory-real-broadcastchannel-refusal-smoke-report",
  shape: "broadcastchannel",
  anchors: {
    anchor: "machinen-real-broadcastchannel-refusal-anchor-v1",
    marker: "worker-boundary:broadcastchannel-refusal:unsupported",
  },
  semanticState: {
    kind: "broadcastchannel-refusal",
    anchor: "machinen-real-broadcastchannel-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-broadcastchannel-unsupported",
  refusalReason:
    "broadcastchannel refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
