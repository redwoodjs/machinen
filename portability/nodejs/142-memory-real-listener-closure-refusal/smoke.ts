#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "142-memory-real-listener-closure-refusal",
  rowDir: "portability/nodejs/142-memory-real-listener-closure-refusal",
  kind: "machinen.nodejs-portability-memory-real-listener-closure-refusal-smoke-report",
  shape: "listener-closure",
  anchors: {
    anchor: "machinen-real-listener-closure-refusal-anchor-v1",
    marker: "eventemitter-advanced:listener-closure-refusal:unsupported",
  },
  semanticState: {
    kind: "listener-closure-refusal",
    anchor: "machinen-real-listener-closure-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-listener-closure-unsupported",
  refusalReason:
    "listener closure refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
