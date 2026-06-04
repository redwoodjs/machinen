#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "275-memory-real-active-refresh-refusal",
  rowDir: "portability/nodejs/275-memory-real-active-refresh-refusal",
  kind: "machinen.nodejs-portability-memory-real-active-refresh-refusal-smoke-report",
  shape: "active-refresh",
  anchors: {
    anchor: "machinen-real-active-refresh-refusal-anchor-v1",
    marker: "auth-session:active-refresh-refusal:unsupported",
  },
  semanticState: {
    kind: "active-refresh-refusal",
    anchor: "machinen-real-active-refresh-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-active-refresh-unsupported",
  refusalReason:
    "active refresh refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
