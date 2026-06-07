#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "179-memory-real-native-addon-expanded-refusal",
  rowDir: "portability/nodejs/179-memory-real-native-addon-expanded-refusal",
  kind: "machinen.nodejs-portability-memory-real-native-addon-expanded-refusal-smoke-report",
  shape: "native-addon-expanded",
  anchors: {
    anchor: "machinen-real-native-addon-expanded-refusal-anchor-v1",
    marker: "process-native-boundary:native-addon-expanded-refusal:unsupported",
  },
  semanticState: {
    kind: "native-addon-expanded-refusal",
    anchor: "machinen-real-native-addon-expanded-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-native-addon-unsupported",
  refusalReason:
    "native addon expanded refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
