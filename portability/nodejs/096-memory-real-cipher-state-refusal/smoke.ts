#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "096-memory-real-cipher-state-refusal",
  rowDir: "portability/nodejs/096-memory-real-cipher-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-cipher-state-refusal-smoke-report",
  shape: "cipher-state",
  anchors: {
    anchor: "machinen-real-cipher-state-refusal-anchor-v1",
    marker: "crypto-memory:cipher-state-refusal:unsupported",
  },
  semanticState: {
    kind: "cipher-state-refusal",
    anchor: "machinen-real-cipher-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-cipher-unsupported",
  refusalReason:
    "cipher state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
