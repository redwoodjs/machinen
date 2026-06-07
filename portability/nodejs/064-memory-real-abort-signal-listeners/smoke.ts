#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "064-memory-real-abort-signal-listeners",
  rowDir: "portability/nodejs/064-memory-real-abort-signal-listeners",
  kind: "machinen.nodejs-portability-memory-real-abort-signal-listeners-smoke-report",
  shape: "abort-signal-listeners",
  anchors: {
    anchor: "machinen-real-abort-signal-listeners-anchor-v1",
    marker: "abort-signal-listeners:semantic-state",
  },
  semanticState: {
    kind: "abort-signal-listeners",
    anchor: "machinen-real-abort-signal-listeners-anchor-v1",
    supportMode: "product-owned-nodejs-memory-ir-validation-materialization",
  },
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
