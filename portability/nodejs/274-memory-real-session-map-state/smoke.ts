#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "274-memory-real-session-map-state",
  rowDir: "portability/nodejs/274-memory-real-session-map-state",
  kind: "machinen.nodejs-portability-memory-real-session-map-state-smoke-report",
  shape: "session-map-state",
  anchors: {
    anchor: "machinen-real-session-map-state-anchor-v1",
    marker: "auth-session:session-map-state:unsupported",
  },
  semanticState: {
    kind: "session-map-state",
    anchor: "machinen-real-session-map-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-session-map-unsupported",
  refusalReason:
    "session map state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
