#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "288-memory-real-singleton-registry-state",
  rowDir: "portability/nodejs/288-memory-real-singleton-registry-state",
  kind: "machinen.nodejs-portability-memory-real-singleton-registry-state-smoke-report",
  shape: "singleton-registry-state",
  anchors: {
    anchor: "machinen-real-singleton-registry-state-anchor-v1",
    marker: "dependency-injection:singleton-registry-state:unsupported",
  },
  semanticState: {
    kind: "singleton-registry-state",
    anchor: "machinen-real-singleton-registry-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-singleton-registry-unsupported",
  refusalReason:
    "singleton registry state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
