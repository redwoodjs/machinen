#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "158-memory-real-env-derived-config-state",
  rowDir: "portability/nodejs/158-memory-real-env-derived-config-state",
  kind: "machinen.nodejs-portability-memory-real-env-derived-config-state-smoke-report",
  shape: "env-derived-config-state",
  anchors: {
    anchor: "machinen-real-env-derived-config-state-anchor-v1",
    marker: "config-state:env-derived-config-state:unsupported",
  },
  semanticState: {
    kind: "env-derived-config-state",
    anchor: "machinen-real-env-derived-config-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-env-derived-config-unsupported",
  refusalReason:
    "env derived config state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
