#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "253-memory-real-package-config-cache-state",
  rowDir: "portability/nodejs/253-memory-real-package-config-cache-state",
  kind: "machinen.nodejs-portability-memory-real-package-config-cache-state-smoke-report",
  shape: "package-config-cache-state",
  anchors: {
    anchor: "machinen-real-package-config-cache-state-anchor-v1",
    marker: "package-runtime-metadata:package-config-cache-state:unsupported",
  },
  semanticState: {
    kind: "package-config-cache-state",
    anchor: "machinen-real-package-config-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-package-config-cache-unsupported",
  refusalReason:
    "package config cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
