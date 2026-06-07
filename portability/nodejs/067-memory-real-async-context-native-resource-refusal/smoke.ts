#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "067-memory-real-async-context-native-resource-refusal",
  rowDir: "portability/nodejs/067-memory-real-async-context-native-resource-refusal",
  kind: "machinen.nodejs-portability-memory-real-async-context-native-resource-refusal-smoke-report",
  shape: "async-context-native-resource",
  anchors: {
    anchor: "machinen-real-async-context-native-resource-refusal-anchor-v1",
    marker: "async-context:async-context-native-resource-refusal:unsupported",
  },
  semanticState: {
    kind: "async-context-native-resource-refusal",
    anchor: "machinen-real-async-context-native-resource-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-async-context-native-resource-unsupported",
  refusalReason:
    "async context native resource refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
