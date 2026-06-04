#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "276-memory-real-crypto-secret-refusal",
  rowDir: "portability/nodejs/276-memory-real-crypto-secret-refusal",
  kind: "machinen.nodejs-portability-memory-real-crypto-secret-refusal-smoke-report",
  shape: "crypto-secret",
  anchors: {
    anchor: "machinen-real-crypto-secret-refusal-anchor-v1",
    marker: "auth-session:crypto-secret-refusal:unsupported",
  },
  semanticState: {
    kind: "crypto-secret-refusal",
    anchor: "machinen-real-crypto-secret-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-crypto-secret-unsupported",
  refusalReason:
    "crypto secret refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
