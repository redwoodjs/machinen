#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    before: { type: "string" },
    after: { type: "string" },
    plan: { type: "string", default: "scripts/smoke/move-envelope-speed-plan.json" },
    json: { type: "boolean", default: false },
  },
});

if (!values.before || !values.after) {
  console.error(
    "usage: move-envelope-speed-report --before <dir> --after <dir> [--plan plan.json] [--json]",
  );
  process.exit(2);
}

const plan = JSON.parse(readFileSync(values.plan, "utf8"));
const before = readSummary(values.before);
const after = readSummary(values.after);
const report = {
  state: before.state === "passed" && after.state === "passed" ? "passed" : "failed",
  plan: plan.name ?? values.plan,
  before: summarizeRun(before),
  after: summarizeRun(after),
  delta: compareRuns(before, after),
  chunks: compareChunks(before, after),
};

if (values.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`speed report: ${report.plan}`);
  console.log(
    `total: ${formatMs(report.before.totalWallMs)} -> ${formatMs(report.after.totalWallMs)} (${formatPercent(report.delta.totalWallPercent)})`,
  );
  console.log(
    `matrix timings: ${formatMs(report.before.matrixTimingMs)} -> ${formatMs(report.after.matrixTimingMs)} (${formatPercent(report.delta.matrixTimingPercent)})`,
  );
  console.log(
    `coverage: ${formatMs(report.before.coverageWallMs)} -> ${formatMs(report.after.coverageWallMs)}`,
  );
  for (const chunk of report.chunks) {
    console.log(
      `- ${chunk.name}: wall ${formatMs(chunk.beforeWallMs)} -> ${formatMs(chunk.afterWallMs)} (${formatPercent(chunk.wallPercent)}), timings ${formatMs(chunk.beforeTimingMs)} -> ${formatMs(chunk.afterTimingMs)} (${formatPercent(chunk.timingPercent)})`,
    );
  }
}

if (report.state !== "passed") {
  process.exit(1);
}

function readSummary(dir) {
  return JSON.parse(readFileSync(join(dir, "benchmark-summary.json"), "utf8"));
}

function summarizeRun(run) {
  return {
    label: run.label,
    mode: run.mode,
    state: run.state,
    totalWallMs: run.totalWallMs,
    matrixTimingMs: sumMatrixTimings(run),
    bootTimingMs: sumTiming(run, "boot-pair"),
    provisionTimingMs: sumTiming(run, "provision-pair"),
    proofTimingMs: sumProofTimings(run),
    coverageWallMs: run.coverage?.wallMs ?? 0,
    coveredCount: run.coverage?.coveredCount,
    expectedCount: run.coverage?.expectedCount,
  };
}

function compareRuns(before, after) {
  const b = summarizeRun(before);
  const a = summarizeRun(after);
  return {
    totalWallMs: a.totalWallMs - b.totalWallMs,
    totalWallPercent: percentDelta(b.totalWallMs, a.totalWallMs),
    matrixTimingMs: a.matrixTimingMs - b.matrixTimingMs,
    matrixTimingPercent: percentDelta(b.matrixTimingMs, a.matrixTimingMs),
    bootTimingMs: a.bootTimingMs - b.bootTimingMs,
    bootTimingPercent: percentDelta(b.bootTimingMs, a.bootTimingMs),
    provisionTimingMs: a.provisionTimingMs - b.provisionTimingMs,
    provisionTimingPercent: percentDelta(b.provisionTimingMs, a.provisionTimingMs),
    proofTimingMs: a.proofTimingMs - b.proofTimingMs,
    proofTimingPercent: percentDelta(b.proofTimingMs, a.proofTimingMs),
  };
}

function compareChunks(before, after) {
  return before.chunks.map((beforeChunk) => {
    const afterChunk = after.chunks.find((chunk) => chunk.name === beforeChunk.name);
    const beforeTimingMs = sumChunkTimings(beforeChunk);
    const afterTimingMs = afterChunk ? sumChunkTimings(afterChunk) : 0;
    return {
      name: beforeChunk.name,
      beforeWallMs: beforeChunk.wallMs,
      afterWallMs: afterChunk?.wallMs ?? 0,
      wallPercent: percentDelta(beforeChunk.wallMs, afterChunk?.wallMs ?? 0),
      beforeTimingMs,
      afterTimingMs,
      timingPercent: percentDelta(beforeTimingMs, afterTimingMs),
      beforeProofs: beforeChunk.proofs,
      afterProofs: afterChunk?.proofs ?? [],
    };
  });
}

function sumMatrixTimings(run) {
  return run.chunks.reduce((sum, chunk) => sum + sumChunkTimings(chunk), 0);
}

function sumChunkTimings(chunk) {
  return (chunk.timings ?? []).reduce((sum, timing) => sum + (timing.durationMs ?? 0), 0);
}

function sumTiming(run, name) {
  return run.chunks.reduce(
    (sum, chunk) =>
      sum +
      (chunk.timings ?? [])
        .filter((timing) => timing.name === name)
        .reduce((inner, timing) => inner + (timing.durationMs ?? 0), 0),
    0,
  );
}

function sumProofTimings(run) {
  return run.chunks.reduce(
    (sum, chunk) =>
      sum +
      (chunk.timings ?? [])
        .filter((timing) => timing.name?.startsWith("proof:"))
        .reduce((inner, timing) => inner + (timing.durationMs ?? 0), 0),
    0,
  );
}

function percentDelta(before, after) {
  if (!before) {
    return null;
  }
  return ((after - before) / before) * 100;
}

function formatMs(value) {
  return `${(value / 1000).toFixed(3)}s`;
}

function formatPercent(value) {
  return value === null ? "n/a" : `${value.toFixed(1)}%`;
}
