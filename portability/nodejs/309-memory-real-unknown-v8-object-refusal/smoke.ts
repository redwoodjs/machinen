#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "309-memory-real-unknown-v8-object-refusal",
  rowDir: "portability/nodejs/309-memory-real-unknown-v8-object-refusal",
  kind: "machinen.nodejs-portability-memory-real-unknown-v8-object-refusal-smoke-report",
  shape: "unknown-v8-object",
  anchors: {
    anchor: "machinen-real-unknown-v8-object-refusal-anchor-v1",
    marker: "unknown-opaque-hardening:unknown-v8-object-refusal:unsupported",
  },
  semanticState: {
    kind: "unknown-v8-object-refusal",
    anchor: "machinen-real-unknown-v8-object-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-unknown-v8-object-unsupported",
  refusalReason:
    "unknown v8 object refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
