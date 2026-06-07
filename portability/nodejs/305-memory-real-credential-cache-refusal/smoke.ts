#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "305-memory-real-credential-cache-refusal",
  rowDir: "portability/nodejs/305-memory-real-credential-cache-refusal",
  kind: "machinen.nodejs-portability-memory-real-credential-cache-refusal-smoke-report",
  shape: "credential-cache",
  anchors: {
    anchor: "machinen-real-credential-cache-refusal-anchor-v1",
    marker: "security-sensitive:credential-cache-refusal:unsupported",
  },
  semanticState: {
    kind: "credential-cache-refusal",
    anchor: "machinen-real-credential-cache-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-credential-cache-unsupported",
  refusalReason:
    "credential cache refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
