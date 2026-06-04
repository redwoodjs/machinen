#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "311-memory-real-metadata-only-success-refusal",
  rowDir: "portability/nodejs/311-memory-real-metadata-only-success-refusal",
  kind: "machinen.nodejs-portability-memory-real-metadata-only-success-refusal-smoke-report",
  shape: "metadata-only-success",
  anchors: {
    anchor: "machinen-real-metadata-only-success-refusal-anchor-v1",
    marker: "unknown-opaque-hardening:metadata-only-success-refusal:unsupported",
  },
  semanticState: {
    kind: "metadata-only-success-refusal",
    anchor: "machinen-real-metadata-only-success-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-metadata-only-success-unsupported",
  refusalReason:
    "metadata only success refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
