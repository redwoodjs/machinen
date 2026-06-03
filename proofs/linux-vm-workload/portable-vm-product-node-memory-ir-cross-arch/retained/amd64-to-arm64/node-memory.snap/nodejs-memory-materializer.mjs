#!/usr/bin/env node
/* eslint-disable curly */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const KIND = "machinen.nodejs.memory-ir";
const VERSION = 1;
const forbiddenRawFields = new Set([
  "rawV8Heap",
  "rawV8HeapBytes",
  "heapBytes",
  "rawHeapBytes",
  "v8HeapSnapshot",
  "samePid",
  "pidContinuation",
  "rawCpuState",
  "sourceIsaEmulation",
]);
const args = parseArgs(process.argv.slice(2));
const ir = JSON.parse(readFileSync(args.ir, "utf8"));
const validation = validate(ir);
if (!validation.accepted) {
  console.error(
    JSON.stringify({
      accepted: false,
      refusalCode: validation.refusalCode,
      errors: validation.errors,
    }),
  );
  process.exit(2);
}
const state = ir.rows[0]?.semanticState ?? {};
mkdirSync(args.targetDir, { recursive: true });
writeFileSync(
  join(args.targetDir, "node-memory-state.json"),
  JSON.stringify(state, null, 2) + "\n",
);
writeFileSync(
  join(args.targetDir, "node-memory-ir-summary.json"),
  JSON.stringify(
    { kind: ir.kind, version: ir.version, materializedRows: ir.rows.length },
    null,
    2,
  ) + "\n",
);
writeFileSync(join(args.targetDir, "node-memory-app.mjs"), targetAppSource(state, args.port));
console.log(
  JSON.stringify({
    accepted: true,
    materializedRows: ir.rows.length,
    app: join(args.targetDir, "node-memory-app.mjs"),
    state: join(args.targetDir, "node-memory-state.json"),
    claimGuard: claimGuard(),
  }),
);

function parseArgs(argv) {
  let ir = "/mnt/capture/nodejs-memory-ir.json";
  let targetDir = "/opt/machinen-all3";
  let port = 18182;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--ir") ir = argv[++index] ?? ir;
    else if (arg === "--target-dir") targetDir = argv[++index] ?? targetDir;
    else if (arg === "--port") port = Number(argv[++index] ?? port);
    else throw new Error(`unknown argument ${arg}`);
  }
  assert(Number.isInteger(port) && port > 0, "--port must be a positive integer");
  return { ir: resolve(ir), targetDir: resolve(targetDir), port };
}

function targetAppSource(state, port) {
  return `import http from "node:http";
const state = ${JSON.stringify(state)};
globalThis.__machinenMaterializedNodeMemoryState = state;
http.createServer((req, res) => {
  if (req.url === "/state") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(state)); return; }
  if (req.url === "/value") { res.end("memory-ready"); return; }
  res.writeHead(404); res.end("not found");
}).listen(${JSON.stringify(port)}, "127.0.0.1");
`;
}

function validate(value) {
  const errors = [];
  if (!isRecord(value))
    return {
      accepted: false,
      refusalCode: "node-portability-memory-ir-invalid",
      errors: ["Node memory IR must be a JSON object"],
    };
  if (value.kind !== KIND) errors.push(`kind must be ${KIND}`);
  if (value.version !== VERSION) errors.push(`version must be ${VERSION}`);
  rejectForbiddenRawFields(value, "$", errors);
  const unsupported = Array.isArray(value.unsupported) ? value.unsupported : [];
  if (unsupported.length > 0)
    errors.push("unsupported Node memory IR entries must refuse before materialization");
  if (!Array.isArray(value.rows)) errors.push("rows must be an array");
  else value.rows.forEach((row, index) => validateRow(row, index, errors));
  return {
    accepted: errors.length === 0,
    refusalCode: refusalCodeFor(errors, unsupported.length),
    errors,
  };
}

function validateRow(row, index, errors) {
  if (!isRecord(row)) {
    errors.push(`rows[${index}] must be an object`);
    return;
  }
  if (typeof row.id !== "string" || row.id.length === 0)
    errors.push(`rows[${index}].id must be a non-empty string`);
  if (typeof row.shape !== "string" || row.shape.length === 0)
    errors.push(`rows[${index}].shape must be a non-empty string`);
  if (!isRecord(row.semanticState)) errors.push(`rows[${index}].semanticState must be an object`);
  rejectForbiddenRawFields(row, `rows[${index}]`, errors);
}

function rejectForbiddenRawFields(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenRawFields(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenRawFields.has(key))
      errors.push(`${path}.${key} is not allowed in semantic Node memory IR`);
    rejectForbiddenRawFields(nested, `${path}.${key}`, errors);
  }
}

function refusalCodeFor(errors, unsupportedCount) {
  if (errors.length === 0) return null;
  return unsupportedCount > 0
    ? "node-portability-memory-ir-unsupported"
    : "node-portability-memory-ir-invalid";
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function claimGuard() {
  return {
    arbitraryNodeProcessRestoreClaimed: false,
    rawV8HeapRestoreUsed: false,
    samePidContinuationClaimed: false,
    rawCpuStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
  };
}
