#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "263-memory-real-persisted-schedule-spec-state",
  rowDir: "portability/nodejs/263-memory-real-persisted-schedule-spec-state",
  kind: "machinen.nodejs-portability-memory-real-persisted-schedule-spec-state-smoke-report",
  shape: "persisted-schedule-spec-state",
  anchors: {
    anchor: "machinen-real-persisted-schedule-spec-state-anchor-v1",
    marker: "job-schedulers:persisted-schedule-spec-state:unsupported",
  },
  semanticState: {
    kind: "persisted-schedule-spec-state",
    anchor: "machinen-real-persisted-schedule-spec-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-persisted-schedule-spec-unsupported",
  refusalReason:
    "persisted schedule spec state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
