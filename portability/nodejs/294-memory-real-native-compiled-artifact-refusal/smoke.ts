#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "294-memory-real-native-compiled-artifact-refusal",
  rowDir: "portability/nodejs/294-memory-real-native-compiled-artifact-refusal",
  kind: "machinen.nodejs-portability-memory-real-native-compiled-artifact-refusal-smoke-report",
  shape: "native-compiled-artifact",
  anchors: {
    anchor: "machinen-real-native-compiled-artifact-refusal-anchor-v1",
    marker: "template-render:native-compiled-artifact-refusal:unsupported",
  },
  semanticState: {
    kind: "native-compiled-artifact-refusal",
    anchor: "machinen-real-native-compiled-artifact-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-native-compiled-artifact-unsupported",
  refusalReason:
    "native compiled artifact refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
