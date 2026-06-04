#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "124-memory-real-shared-backing-store-state",
  rowDir: "portability/nodejs/124-memory-real-shared-backing-store-state",
  kind: "machinen.nodejs-portability-memory-real-shared-backing-store-state-smoke-report",
  shape: "shared-backing-store-state",
  anchors: {
    anchor: "machinen-real-shared-backing-store-state-anchor-v1",
    marker: "buffer-advanced:shared-backing-store-state:unsupported",
  },
  semanticState: {
    kind: "shared-backing-store-state",
    anchor: "machinen-real-shared-backing-store-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-shared-backing-store-unsupported",
  refusalReason:
    "shared backing store state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
