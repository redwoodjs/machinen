#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "205-memory-real-well-known-symbol-behavior-state",
  rowDir: "portability/nodejs/205-memory-real-well-known-symbol-behavior-state",
  kind: "machinen.nodejs-portability-memory-real-well-known-symbol-behavior-state-smoke-report",
  shape: "well-known-symbol-behavior-state",
  anchors: {
    anchor: "machinen-real-well-known-symbol-behavior-state-anchor-v1",
    marker: "symbol-detail:well-known-symbol-behavior-state:unsupported",
  },
  semanticState: {
    kind: "well-known-symbol-behavior-state",
    anchor: "machinen-real-well-known-symbol-behavior-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-well-known-symbol-behavior-unsupported",
  refusalReason:
    "well known symbol behavior state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
