#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "279-memory-real-sliding-window-state",
  rowDir: "portability/nodejs/279-memory-real-sliding-window-state",
  kind: "machinen.nodejs-portability-memory-real-sliding-window-state-smoke-report",
  shape: "sliding-window-state",
  anchors: {
    anchor: "machinen-real-sliding-window-state-anchor-v1",
    marker: "rate-limiting:sliding-window-state:unsupported",
  },
  semanticState: {
    kind: "sliding-window-state",
    anchor: "machinen-real-sliding-window-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-sliding-window-unsupported",
  refusalReason:
    "sliding window state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
