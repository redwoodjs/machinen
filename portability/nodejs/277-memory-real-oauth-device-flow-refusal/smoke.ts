#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "277-memory-real-oauth-device-flow-refusal",
  rowDir: "portability/nodejs/277-memory-real-oauth-device-flow-refusal",
  kind: "machinen.nodejs-portability-memory-real-oauth-device-flow-refusal-smoke-report",
  shape: "oauth-device-flow",
  anchors: {
    anchor: "machinen-real-oauth-device-flow-refusal-anchor-v1",
    marker: "auth-session:oauth-device-flow-refusal:unsupported",
  },
  semanticState: {
    kind: "oauth-device-flow-refusal",
    anchor: "machinen-real-oauth-device-flow-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-oauth-device-flow-unsupported",
  refusalReason:
    "oauth device flow refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
