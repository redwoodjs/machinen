#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "308-memory-real-opaque-native-handles-refusal",
  rowDir: "portability/nodejs/308-memory-real-opaque-native-handles-refusal",
  kind: "machinen.nodejs-portability-memory-real-opaque-native-handles-refusal-smoke-report",
  shape: "opaque-native-handles",
  anchors: {
    anchor: "machinen-real-opaque-native-handles-refusal-anchor-v1",
    marker: "unknown-opaque-hardening:opaque-native-handles-refusal:unsupported",
  },
  semanticState: {
    kind: "opaque-native-handles-refusal",
    anchor: "machinen-real-opaque-native-handles-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-opaque-native-handles-unsupported",
  refusalReason:
    "opaque native handles refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
