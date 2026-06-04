#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "207-memory-real-symbol-toStringTag-state",
  rowDir: "portability/nodejs/207-memory-real-symbol-toStringTag-state",
  kind: "machinen.nodejs-portability-memory-real-symbol-toStringTag-state-smoke-report",
  shape: "symbol-toStringTag-state",
  anchors: {
    anchor: "machinen-real-symbol-toStringTag-state-anchor-v1",
    marker: "symbol-detail:symbol-toStringTag-state:unsupported",
  },
  semanticState: {
    kind: "symbol-toStringTag-state",
    anchor: "machinen-real-symbol-toStringTag-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-symbol-toStringTag-unsupported",
  refusalReason:
    "symbol toStringTag state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
