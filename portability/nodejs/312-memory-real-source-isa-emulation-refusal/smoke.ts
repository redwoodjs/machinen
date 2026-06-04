#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "312-memory-real-source-isa-emulation-refusal",
  rowDir: "portability/nodejs/312-memory-real-source-isa-emulation-refusal",
  kind: "machinen.nodejs-portability-memory-real-source-isa-emulation-refusal-smoke-report",
  shape: "source-isa-emulation",
  anchors: {
    anchor: "machinen-real-source-isa-emulation-refusal-anchor-v1",
    marker: "unknown-opaque-hardening:source-isa-emulation-refusal:unsupported",
  },
  semanticState: {
    kind: "source-isa-emulation-refusal",
    anchor: "machinen-real-source-isa-emulation-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-source-isa-emulation-unsupported",
  refusalReason:
    "source isa emulation refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
