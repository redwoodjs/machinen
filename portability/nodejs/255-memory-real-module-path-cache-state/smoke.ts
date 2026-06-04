#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "255-memory-real-module-path-cache-state",
  rowDir: "portability/nodejs/255-memory-real-module-path-cache-state",
  kind: "machinen.nodejs-portability-memory-real-module-path-cache-state-smoke-report",
  shape: "module-path-cache-state",
  anchors: {
    anchor: "machinen-real-module-path-cache-state-anchor-v1",
    marker: "package-runtime-metadata:module-path-cache-state:unsupported",
  },
  semanticState: {
    kind: "module-path-cache-state",
    anchor: "machinen-real-module-path-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-module-path-cache-unsupported",
  refusalReason:
    "module path cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
