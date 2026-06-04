#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "232-memory-real-diagnostic-channel-refusal",
  rowDir: "portability/nodejs/232-memory-real-diagnostic-channel-refusal",
  kind: "machinen.nodejs-portability-memory-real-diagnostic-channel-refusal-smoke-report",
  shape: "diagnostic-channel",
  anchors: {
    anchor: "machinen-real-diagnostic-channel-refusal-anchor-v1",
    marker: "console-logging:diagnostic-channel-refusal:unsupported",
  },
  semanticState: {
    kind: "diagnostic-channel-refusal",
    anchor: "machinen-real-diagnostic-channel-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-diagnostic-channel-unsupported",
  refusalReason:
    "diagnostic channel refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
