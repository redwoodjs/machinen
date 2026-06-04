#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "120-memory-real-error-cause-chain-state",
  rowDir: "portability/nodejs/120-memory-real-error-cause-chain-state",
  kind: "machinen.nodejs-portability-memory-real-error-cause-chain-state-smoke-report",
  shape: "error-cause-chain-state",
  anchors: {
    anchor: "machinen-real-error-cause-chain-state-anchor-v1",
    marker: "error-advanced:error-cause-chain-state:unsupported",
  },
  semanticState: {
    kind: "error-cause-chain-state",
    anchor: "machinen-real-error-cause-chain-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-error-cause-chain-unsupported",
  refusalReason:
    "error cause chain state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
