#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "273-memory-real-token-cache-state",
  rowDir: "portability/nodejs/273-memory-real-token-cache-state",
  kind: "machinen.nodejs-portability-memory-real-token-cache-state-smoke-report",
  shape: "token-cache-state",
  anchors: {
    anchor: "machinen-real-token-cache-state-anchor-v1",
    marker: "auth-session:token-cache-state:unsupported",
  },
  semanticState: {
    kind: "token-cache-state",
    anchor: "machinen-real-token-cache-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-token-cache-unsupported",
  refusalReason:
    "token cache state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
