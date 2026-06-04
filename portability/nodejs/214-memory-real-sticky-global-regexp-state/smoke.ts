#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "214-memory-real-sticky-global-regexp-state",
  rowDir: "portability/nodejs/214-memory-real-sticky-global-regexp-state",
  kind: "machinen.nodejs-portability-memory-real-sticky-global-regexp-state-smoke-report",
  shape: "sticky-global-regexp-state",
  anchors: {
    anchor: "machinen-real-sticky-global-regexp-state-anchor-v1",
    marker: "regexp-detail:sticky-global-regexp-state:unsupported",
  },
  semanticState: {
    kind: "sticky-global-regexp-state",
    anchor: "machinen-real-sticky-global-regexp-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-sticky-global-regexp-unsupported",
  refusalReason:
    "sticky global regexp state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
