#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "082-memory-real-import-meta-state",
  rowDir: "portability/nodejs/082-memory-real-import-meta-state",
  kind: "machinen.nodejs-portability-memory-real-import-meta-state-smoke-report",
  shape: "import-meta-state",
  anchors: {
    anchor: "machinen-real-import-meta-state-anchor-v1",
    marker: "module-state:import-meta-state:unsupported",
  },
  semanticState: {
    kind: "import-meta-state",
    anchor: "machinen-real-import-meta-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-import-meta-unsupported",
  refusalReason:
    "import meta state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
