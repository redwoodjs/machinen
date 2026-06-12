#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    plan: { type: "string", default: "scripts/smoke/move-envelope-speed-plan.json" },
    "out-dir": { type: "string" },
    mode: { type: "string", default: "fresh" },
    label: { type: "string" },
    cli: {
      type: "string",
      default: process.env.MACHINEN_MOVE_MATRIX_CLI ?? "node packages/cli/dist/cli.js",
    },
    image: { type: "string", default: process.env.MACHINEN_MOVE_MATRIX_IMAGE },
    json: { type: "boolean", default: false },
  },
});

const mode = values.mode;
if (!["fresh", "warm", "parallel"].includes(mode)) {
  fail(`--mode must be fresh, warm, or parallel, got ${mode}`);
}
if (!values["out-dir"]) {
  fail("--out-dir is required");
}
const proofImage = values.image ? resolve(values.image) : undefined;
if (proofImage && !existsSync(proofImage)) {
  fail(`--image not found: ${proofImage}`);
}

const plan = JSON.parse(readFileSync(values.plan, "utf8"));
const chunks = plan.chunks ?? [];
if (chunks.length === 0) {
  fail(`plan has no chunks: ${values.plan}`);
}

const outDir = values["out-dir"];
mkdirSync(outDir, { recursive: true });
const label = values.label ?? `${mode}-${Date.now()}`;
const runId = `${process.pid}-${Date.now()}`;
const src = `move-speed-src-${runId}`;
const tgt = `move-speed-tgt-${runId}`;
const summary = {
  state: "passed",
  label,
  mode,
  plan: plan.name ?? values.plan,
  planPath: values.plan,
  outDir,
  proofImage: proofImage ? { path: proofImage, name: basename(proofImage) } : undefined,
  startedAt: new Date().toISOString(),
  finishedAt: undefined,
  totalWallMs: 0,
  chunks: [],
  coverage: undefined,
};

const totalStart = Date.now();
try {
  if (mode === "warm") {
    runCli(bootArgs(src), "boot-src");
    runCli(bootArgs(tgt), "boot-tgt");
  }

  if (mode === "parallel") {
    summary.chunks = await Promise.all(chunks.map((chunk) => runChunk(chunk)));
    if (summary.chunks.some((chunk) => chunk.exitCode !== 0 || chunk.state === "failed")) {
      summary.state = "failed";
    }
  } else {
    for (const chunk of chunks) {
      const result = await runChunk(chunk);
      summary.chunks.push(result);
      if (result.exitCode !== 0 || result.state === "failed") {
        summary.state = "failed";
        break;
      }
    }
  }

  if (summary.state === "passed") {
    summary.coverage = await runCoverage();
    if (summary.coverage.exitCode !== 0 || summary.coverage.state !== "passed") {
      summary.state = "failed";
    }
  }
} finally {
  if (mode === "warm") {
    runCli(["stop", src], "stop-src", { allowFailure: true });
    runCli(["stop", tgt], "stop-tgt", { allowFailure: true });
  }
  summary.finishedAt = new Date().toISOString();
  summary.totalWallMs = Date.now() - totalStart;
  writeFileSync(join(outDir, "benchmark-summary.json"), JSON.stringify(summary, null, 2) + "\n");
}

if (values.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`${summary.state}: ${label} mode=${mode} total=${summary.totalWallMs}ms`);
  for (const chunk of summary.chunks) {
    console.log(`- ${chunk.name}: ${chunk.wallMs}ms state=${chunk.state}`);
  }
  if (summary.coverage) {
    console.log(
      `- coverage: ${summary.coverage.wallMs}ms ${summary.coverage.coveredCount}/${summary.coverage.expectedCount}`,
    );
  }
}

if (summary.state !== "passed") {
  process.exit(1);
}

async function runChunk(chunk) {
  const chunkStart = Date.now();
  const outputPath = join(outDir, `${chunk.name}.json`);
  const result = await runProcess("pnpm", matrixChunkArgs(chunk));
  persistProcessOutput(outputPath, join(outDir, `${chunk.name}.stderr.log`), result);
  return chunkResult(chunk, outputPath, result, Date.now() - chunkStart);
}

function matrixChunkArgs(chunk) {
  const args = [
    "proof-move-envelope-matrix",
    "--",
    "--json",
    "--timings",
    "--chunk-plan",
    values.plan,
    "--chunk",
    chunk.name,
  ];
  if (proofImage) {
    args.push("--image", proofImage);
  }
  return mode === "warm" ? [...args, "--reuse-vms", `${src}:${tgt}`] : args;
}

function bootArgs(name) {
  return [
    "boot",
    ...optionalArg(proofImage),
    "--name",
    name,
    "--detach",
    "--json",
    "--",
    "sleep",
    "infinity",
  ];
}

function chunkResult(chunk, outputPath, result, wallMs) {
  const parsed = parsedMatrix(result);
  return {
    name: chunk.name,
    category: chunk.category,
    expectedProofs: array(chunk.proofs),
    outputPath,
    wallMs,
    exitCode: result.status,
    state: matrixState(parsed, result),
    failure: matrixFailure(parsed, result),
    timings: array(parsed.timings),
    proofs: proofSummaries(parsed.proofs),
  };
}

async function runCoverage() {
  const coverageStart = Date.now();
  const result = await runProcess("pnpm", coverageArgs());
  persistProcessOutput(join(outDir, "coverage.json"), join(outDir, "coverage.stderr.log"), result);
  return coverageResult(result, Date.now() - coverageStart);
}

function coverageArgs() {
  return [
    "proof-move-envelope-matrix",
    "--",
    "--json",
    "--chunk-plan",
    values.plan,
    "--coverage-dir",
    outDir,
  ];
}

function coverageResult(result, wallMs) {
  const parsed = parsedMatrix(result);
  return {
    wallMs,
    exitCode: result.status,
    state: matrixState(parsed, result),
    expectedCount: parsed.expectedCount,
    coveredCount: parsed.coveredCount,
    missing: array(parsed.missing),
    failed: array(parsed.failed),
  };
}

function persistProcessOutput(stdoutPath, stderrPath, result) {
  writeFileSync(stdoutPath, result.stdout);
  if (result.stderr) {
    writeFileSync(stderrPath, result.stderr);
  }
}

function parsedMatrix(result) {
  return parseMatrixJson(result.stdout) ?? {};
}

function matrixState(parsed, result) {
  return parsed.state ?? processState(result);
}

function matrixFailure(parsed, result) {
  return parsed.failure ?? classifyFailure(result.stdout, result.stderr);
}

function processState(result) {
  return result.status === 0 ? "unknown" : "failed";
}

function proofSummaries(proofs) {
  return array(proofs).map((proof) => ({ name: proof.name, state: proof.state }));
}

function optionalArg(value) {
  return value ? [value] : [];
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function runProcess(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

function runCli(args, name, options = {}) {
  const [bin, ...baseArgs] = values.cli.split(" ").filter(Boolean);
  const result = spawnSync(bin, [...baseArgs, ...args], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  writeFileSync(join(outDir, `${name}.stdout.log`), result.stdout ?? "");
  writeFileSync(join(outDir, `${name}.stderr.log`), result.stderr ?? "");
  assertCliSuccess(name, result, options);
}

function assertCliSuccess(name, result, options) {
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${name} failed with exit ${result.status}`);
  }
}

function parseMatrixJson(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return undefined;
  }
}

function classifyFailure(stdout, stderr) {
  const text = `${stdout}\n${stderr}`;
  return /EXEC_AGENT_(?:TIMEOUT|UNAVAILABLE)|VsockExec|EPIPE|gvproxy|timed out after|connection reset|broken pipe/i.test(
    text,
  )
    ? { class: "infrastructure" }
    : undefined;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}
