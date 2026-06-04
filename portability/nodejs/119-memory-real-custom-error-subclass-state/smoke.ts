#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "119-memory-real-custom-error-subclass-state",
  rowDir: "portability/nodejs/119-memory-real-custom-error-subclass-state",
  kind: "machinen.nodejs-portability-memory-real-custom-error-subclass-state-smoke-report",
  shape: "custom-error-subclass-state",
  anchors: {
    anchor: "machinen-real-custom-error-subclass-state-anchor-v1",
    marker: "error-advanced:custom-error-subclass-state:unsupported",
  },
  semanticState: {
    kind: "custom-error-subclass-state",
    anchor: "machinen-real-custom-error-subclass-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-custom-error-subclass-unsupported",
  refusalReason:
    "custom error subclass state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
