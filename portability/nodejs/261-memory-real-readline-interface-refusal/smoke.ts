#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "261-memory-real-readline-interface-refusal",
  rowDir: "portability/nodejs/261-memory-real-readline-interface-refusal",
  kind: "machinen.nodejs-portability-memory-real-readline-interface-refusal-smoke-report",
  shape: "readline-interface",
  anchors: {
    anchor: "machinen-real-readline-interface-refusal-anchor-v1",
    marker: "cli-app-state:readline-interface-refusal:unsupported",
  },
  semanticState: {
    kind: "readline-interface-refusal",
    anchor: "machinen-real-readline-interface-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-readline-interface-unsupported",
  refusalReason:
    "readline interface refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
