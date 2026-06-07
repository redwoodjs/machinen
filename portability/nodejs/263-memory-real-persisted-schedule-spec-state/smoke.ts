#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "263-memory-real-persisted-schedule-spec-state",
  rowDir: "portability/nodejs/263-memory-real-persisted-schedule-spec-state",
  kind: "machinen.nodejs-portability-memory-real-persisted-schedule-spec-state-smoke-report",
  shape: "persisted-schedule-spec-state",
  anchors: {
    anchor: "machinen-real-persisted-schedule-spec-state-anchor-v1",
    marker: "persisted-schedule-spec-state:semantic-state",
  },
  semanticState: {
    kind: "persisted-schedule-spec-state",
    anchor: "machinen-real-persisted-schedule-spec-state-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
