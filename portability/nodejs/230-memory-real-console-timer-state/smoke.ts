#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "230-memory-real-console-timer-state",
  rowDir: "portability/nodejs/230-memory-real-console-timer-state",
  kind: "machinen.nodejs-portability-memory-real-console-timer-state-smoke-report",
  shape: "console-timer-state",
  anchors: {
    anchor: "machinen-real-console-timer-state-anchor-v1",
    marker: "console-logging:console-timer-state:unsupported",
  },
  semanticState: {
    kind: "console-timer-state",
    anchor: "machinen-real-console-timer-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-console-timer-unsupported",
  refusalReason:
    "console timer state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
