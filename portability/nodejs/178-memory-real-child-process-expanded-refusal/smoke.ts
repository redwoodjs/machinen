#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "178-memory-real-child-process-expanded-refusal",
  rowDir: "portability/nodejs/178-memory-real-child-process-expanded-refusal",
  kind: "machinen.nodejs-portability-memory-real-child-process-expanded-refusal-smoke-report",
  shape: "child-process-expanded",
  anchors: {
    anchor: "machinen-real-child-process-expanded-refusal-anchor-v1",
    marker: "process-native-boundary:child-process-expanded-refusal:unsupported",
  },
  semanticState: {
    kind: "child-process-expanded-refusal",
    anchor: "machinen-real-child-process-expanded-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-child-process-unsupported",
  refusalReason:
    "child process expanded refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
