#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "262-memory-real-tty-state-refusal",
  rowDir: "portability/nodejs/262-memory-real-tty-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-tty-state-refusal-smoke-report",
  shape: "tty-state",
  anchors: {
    anchor: "machinen-real-tty-state-refusal-anchor-v1",
    marker: "cli-app-state:tty-state-refusal:unsupported",
  },
  semanticState: {
    kind: "tty-state-refusal",
    anchor: "machinen-real-tty-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-tty-unsupported",
  refusalReason:
    "tty state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
