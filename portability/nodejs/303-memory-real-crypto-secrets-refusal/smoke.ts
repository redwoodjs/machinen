#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "303-memory-real-crypto-secrets-refusal",
  rowDir: "portability/nodejs/303-memory-real-crypto-secrets-refusal",
  kind: "machinen.nodejs-portability-memory-real-crypto-secrets-refusal-smoke-report",
  shape: "crypto-secrets",
  anchors: {
    anchor: "machinen-real-crypto-secrets-refusal-anchor-v1",
    marker: "security-sensitive:crypto-secrets-refusal:unsupported",
  },
  semanticState: {
    kind: "crypto-secrets-refusal",
    anchor: "machinen-real-crypto-secrets-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-crypto-secrets-unsupported",
  refusalReason:
    "crypto secrets refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
