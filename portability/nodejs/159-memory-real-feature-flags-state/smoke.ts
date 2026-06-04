#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "159-memory-real-feature-flags-state",
  rowDir: "portability/nodejs/159-memory-real-feature-flags-state",
  kind: "machinen.nodejs-portability-memory-real-feature-flags-state-smoke-report",
  shape: "feature-flags-state",
  anchors: {
    anchor: "machinen-real-feature-flags-state-anchor-v1",
    marker: "config-state:feature-flags-state:unsupported",
  },
  semanticState: {
    kind: "feature-flags-state",
    anchor: "machinen-real-feature-flags-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-feature-flags-unsupported",
  refusalReason:
    "feature flags state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
