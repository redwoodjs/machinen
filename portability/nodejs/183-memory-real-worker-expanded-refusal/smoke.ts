#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "183-memory-real-worker-expanded-refusal",
  rowDir: "portability/nodejs/183-memory-real-worker-expanded-refusal",
  kind: "machinen.nodejs-portability-memory-real-worker-expanded-refusal-smoke-report",
  shape: "worker-expanded",
  anchors: {
    anchor: "machinen-real-worker-expanded-refusal-anchor-v1",
    marker: "worker-boundary:worker-expanded-refusal:unsupported",
  },
  semanticState: {
    kind: "worker-expanded-refusal",
    anchor: "machinen-real-worker-expanded-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-worker-unsupported",
  refusalReason:
    "worker expanded refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
