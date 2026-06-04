#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "258-memory-real-parsed-args-state",
  rowDir: "portability/nodejs/258-memory-real-parsed-args-state",
  kind: "machinen.nodejs-portability-memory-real-parsed-args-state-smoke-report",
  shape: "parsed-args-state",
  anchors: {
    anchor: "machinen-real-parsed-args-state-anchor-v1",
    marker: "cli-app-state:parsed-args-state:unsupported",
  },
  semanticState: {
    kind: "parsed-args-state",
    anchor: "machinen-real-parsed-args-state-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-parsed-args-unsupported",
  refusalReason:
    "parsed args state is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
