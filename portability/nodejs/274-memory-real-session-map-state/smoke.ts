#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "274-memory-real-session-map-state",
  rowDir: "portability/nodejs/274-memory-real-session-map-state",
  kind: "machinen.nodejs-portability-memory-real-session-map-state-smoke-report",
  shape: "session-map-state",
  anchors: {
    anchor: "machinen-real-session-map-state-anchor-v1",
    marker: "session-map-state:semantic-state",
  },
  semanticState: {
    kind: "session-map-state",
    anchor: "machinen-real-session-map-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
