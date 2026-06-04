#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "064-memory-real-abort-signal-listeners",
  rowDir: "portability/nodejs/064-memory-real-abort-signal-listeners",
  kind: "machinen.nodejs-portability-memory-real-abort-signal-listeners-smoke-report",
  shape: "abort-signal-listeners",
  anchors: {
    anchor: "machinen-real-abort-signal-listeners-anchor-v1",
    marker: "async-context:abort-signal-listeners:unsupported",
  },
  semanticState: {
    kind: "abort-signal-listeners",
    anchor: "machinen-real-abort-signal-listeners-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-abort-signal-listeners-unsupported",
  refusalReason:
    "abort signal listeners is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
