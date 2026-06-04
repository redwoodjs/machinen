#!/usr/bin/env tsx
import { runRealMemorySmoke, type RealMemorySpec } from "../lib/real-memory-smoke.ts";

const spec = {
  rowId: "287-memory-real-otel-exporter-refusal",
  rowDir: "portability/nodejs/287-memory-real-otel-exporter-refusal",
  kind: "machinen.nodejs-portability-memory-real-otel-exporter-refusal-smoke-report",
  shape: "otel-exporter",
  anchors: {
    anchor: "machinen-real-otel-exporter-refusal-anchor-v1",
    marker: "observability:otel-exporter-refusal:unsupported",
  },
  semanticState: {
    kind: "otel-exporter-refusal",
    anchor: "machinen-real-otel-exporter-refusal-anchor-v1",
  },
  refused: true,
  refusalCode: "node-portability-memory-otel-exporter-unsupported",
  refusalReason:
    "otel exporter refusal is not yet proven as portable Node Memory IR semantic state and is refused fail-closed",
} satisfies RealMemorySpec;

runRealMemorySmoke(spec).catch((error) => {
  console.error(error);
  process.exit(1);
});
