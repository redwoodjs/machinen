#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "099-memory-real-textdecoder-state",
  rowDir: "portability/nodejs/099-memory-real-textdecoder-state",
  kind: "machinen.nodejs-portability-memory-real-textdecoder-state-smoke-report",
  shape: "textdecoder-state",
  anchors: {
    anchor: "machinen-real-textdecoder-state-anchor-v1",
    marker: "text-data:textdecoder-state:unsupported",
  },
  semanticState: {
    kind: "textdecoder-state",
    anchor: "machinen-real-textdecoder-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-textdecoder-unsupported",
  refusalReason:
    "textdecoder state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
