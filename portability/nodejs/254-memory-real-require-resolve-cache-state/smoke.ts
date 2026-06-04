#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "254-memory-real-require-resolve-cache-state",
  rowDir: "portability/nodejs/254-memory-real-require-resolve-cache-state",
  kind: "machinen.nodejs-portability-memory-real-require-resolve-cache-state-smoke-report",
  shape: "require-resolve-cache-state",
  anchors: {
    anchor: "machinen-real-require-resolve-cache-state-anchor-v1",
    marker: "package-runtime-metadata:require-resolve-cache-state:unsupported",
  },
  semanticState: {
    kind: "require-resolve-cache-state",
    anchor: "machinen-real-require-resolve-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-require-resolve-cache-unsupported",
  refusalReason:
    "require resolve cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
