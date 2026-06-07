#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "167-memory-real-http-agent-state-refusal",
  rowDir: "portability/nodejs/167-memory-real-http-agent-state-refusal",
  kind: "machinen.nodejs-portability-memory-real-http-agent-state-refusal-smoke-report",
  shape: "http-agent-state",
  anchors: {
    anchor: "machinen-real-http-agent-state-refusal-anchor-v1",
    marker: "http-app-state:http-agent-state-refusal:unsupported",
  },
  semanticState: {
    kind: "http-agent-state-refusal",
    anchor: "machinen-real-http-agent-state-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-http-agent-unsupported",
  refusalReason:
    "http agent state refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
