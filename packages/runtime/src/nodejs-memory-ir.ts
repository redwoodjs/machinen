export const NODEJS_MEMORY_IR_KIND = "machinen.nodejs.memory-ir";
export const NODEJS_MEMORY_IR_VERSION = 1;
export const NODEJS_MEMORY_IR_RESTORE_STRATEGY = "materialize-nodejs-memory-ir-target-native";
export const NODEJS_MEMORY_IR_MATERIALIZER_FILENAME = "nodejs-memory-materializer.mjs";
export const NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE = "node-portability-memory-ir-invalid";
export const NODEJS_MEMORY_IR_UNSUPPORTED_REFUSAL_CODE = "node-portability-memory-ir-unsupported";

export interface NodejsMemoryIrRow {
  id: string;
  shape: string;
  semanticState: Record<string, unknown>;
  anchors?: Record<string, string>;
}

export interface NodejsMemoryIrDocument {
  kind: typeof NODEJS_MEMORY_IR_KIND;
  version: typeof NODEJS_MEMORY_IR_VERSION;
  runtime?: Record<string, unknown>;
  rows: NodejsMemoryIrRow[];
  unsupported?: Array<{ code?: string; reason?: string }>;
  claimGuard?: Record<string, unknown>;
}

export interface NodejsMemoryIrValidationResult {
  accepted: boolean;
  refusalCode: string | null;
  errors: string[];
  rowCount: number;
}

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

export function validateNodejsMemoryIrDocument(value: unknown): NodejsMemoryIrValidationResult {
  const errors: string[] = [];
  const doc = recordOrNull(value);
  if (!doc) {
    return invalid(["Node memory IR must be a JSON object"]);
  }
  if (doc.kind !== NODEJS_MEMORY_IR_KIND) {
    errors.push(`kind must be ${NODEJS_MEMORY_IR_KIND}`);
  }
  if (doc.version !== NODEJS_MEMORY_IR_VERSION) {
    errors.push(`version must be ${NODEJS_MEMORY_IR_VERSION}`);
  }
  rejectForbiddenRawFields(doc, "$", errors);
  const unsupported = Array.isArray(doc.unsupported) ? doc.unsupported : [];
  if (unsupported.length > 0) {
    errors.push("unsupported Node memory IR entries must refuse before materialization");
  }
  if (!Array.isArray(doc.rows)) {
    errors.push("rows must be an array");
  } else {
    doc.rows.forEach((row, index) => validateNodejsMemoryIrRow(row, index, errors));
  }
  return {
    accepted: errors.length === 0,
    refusalCode: refusalCodeFor(errors, unsupported.length),
    errors,
    rowCount: Array.isArray(doc.rows) ? doc.rows.length : 0,
  };
}

export function createNodejsMemoryIrMaterializerModule(): string {
  return `#!/usr/bin/env node
/* eslint-disable curly */
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const KIND = ${JSON.stringify(NODEJS_MEMORY_IR_KIND)};
const VERSION = ${JSON.stringify(NODEJS_MEMORY_IR_VERSION)};
const forbiddenRawFields = new Set(${JSON.stringify([...forbiddenRawFields])});
const args = parseArgs(process.argv.slice(2));
const ir = JSON.parse(readFileSync(args.ir, "utf8"));
const validation = validate(ir);
if (!validation.accepted) {
  console.error(JSON.stringify({ accepted: false, refusalCode: validation.refusalCode, errors: validation.errors }));
  process.exit(2);
}
const rows = ir.rows.map((row) => ({ id: row.id, shape: row.shape, semanticState: row.semanticState }));
const state = rows[0]?.semanticState ?? {};
mkdirSync(args.targetDir, { recursive: true });
writeFileSync(join(args.targetDir, "node-memory-state.json"), JSON.stringify(state, null, 2) + "\\n");
writeFileSync(join(args.targetDir, "node-memory-rows.json"), JSON.stringify(rows, null, 2) + "\\n");
writeFileSync(join(args.targetDir, "node-memory-ir-summary.json"), JSON.stringify({ kind: ir.kind, version: ir.version, materializedRows: ir.rows.length, rowIds: rows.map((row) => row.id) }, null, 2) + "\\n");
writeFileSync(join(args.targetDir, "node-memory-app.mjs"), targetAppSource(state, rows, args.port));
console.log(JSON.stringify({ accepted: true, materializedRows: ir.rows.length, rowIds: rows.map((row) => row.id), app: join(args.targetDir, "node-memory-app.mjs"), state: join(args.targetDir, "node-memory-state.json"), rows: join(args.targetDir, "node-memory-rows.json"), claimGuard: claimGuard() }));

function parseArgs(argv) {
  let ir = "/mnt/capture/nodejs-memory-ir.json";
  let targetDir = "/opt/machinen-all3";
  let port = 18182;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--ir") ir = argv[++index] ?? ir;
    else if (arg === "--target-dir") targetDir = argv[++index] ?? targetDir;
    else if (arg === "--port") port = Number(argv[++index] ?? port);
    else throw new Error(\`unknown argument \${arg}\`);
  }
  assert(Number.isInteger(port) && port > 0, "--port must be a positive integer");
  return { ir: resolve(ir), targetDir: resolve(targetDir), port };
}

function targetAppSource(state, rows, port) {
  return \`import http from "node:http";\nconst state = \${JSON.stringify(state)};\nconst rows = \${JSON.stringify(rows)};\nglobalThis.__machinenMaterializedNodeMemoryState = state;\nglobalThis.__machinenMaterializedNodeMemoryRows = rows;\nhttp.createServer((req, res) => {\n  if (req.url === "/state") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(state)); return; }\n  if (req.url === "/rows") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(rows)); return; }\n  if (req.url === "/value") { res.end("memory-ready"); return; }\n  res.writeHead(404); res.end("not found");\n}).listen(\${JSON.stringify(port)}, "127.0.0.1");\n\`;
}

function validate(value) {
  const errors = [];
  if (!isRecord(value)) return { accepted: false, refusalCode: ${JSON.stringify(NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE)}, errors: ["Node memory IR must be a JSON object"] };
  if (value.kind !== KIND) errors.push(\`kind must be \${KIND}\`);
  if (value.version !== VERSION) errors.push(\`version must be \${VERSION}\`);
  rejectForbiddenRawFields(value, "$", errors);
  const unsupported = Array.isArray(value.unsupported) ? value.unsupported : [];
  if (unsupported.length > 0) errors.push("unsupported Node memory IR entries must refuse before materialization");
  if (!Array.isArray(value.rows)) errors.push("rows must be an array");
  else value.rows.forEach((row, index) => validateRow(row, index, errors));
  return { accepted: errors.length === 0, refusalCode: refusalCodeFor(errors, unsupported.length), errors };
}

function validateRow(row, index, errors) {
  if (!isRecord(row)) { errors.push(\`rows[\${index}] must be an object\`); return; }
  if (typeof row.id !== "string" || row.id.length === 0) errors.push(\`rows[\${index}].id must be a non-empty string\`);
  if (typeof row.shape !== "string" || row.shape.length === 0) errors.push(\`rows[\${index}].shape must be a non-empty string\`);
  if (!isRecord(row.semanticState)) errors.push(\`rows[\${index}].semanticState must be an object\`);
  rejectForbiddenRawFields(row, \`rows[\${index}]\`, errors);
}

function rejectForbiddenRawFields(value, path, errors) {
  if (Array.isArray(value)) { value.forEach((item, index) => rejectForbiddenRawFields(item, \`\${path}[\${index}]\`, errors)); return; }
  if (!isRecord(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenRawFields.has(key)) errors.push(\`\${path}.\${key} is not allowed in semantic Node memory IR\`);
    rejectForbiddenRawFields(nested, \`\${path}.\${key}\`, errors);
  }
}

function refusalCodeFor(errors, unsupportedCount) {
  if (errors.length === 0) return null;
  return unsupportedCount > 0 ? ${JSON.stringify(NODEJS_MEMORY_IR_UNSUPPORTED_REFUSAL_CODE)} : ${JSON.stringify(NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE)};
}

function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function claimGuard() { return { arbitraryNodeProcessRestoreClaimed: false, rawV8HeapRestoreUsed: false, samePidContinuationClaimed: false, rawCpuStateReplayUsed: false, sourceIsaEmulationUsed: false }; }
`;
}

function validateNodejsMemoryIrRow(value: unknown, index: number, errors: string[]): void {
  const row = recordOrNull(value);
  if (!row) {
    errors.push(`rows[${index}] must be an object`);
    return;
  }
  if (typeof row.id !== "string" || row.id.length === 0) {
    errors.push(`rows[${index}].id must be a non-empty string`);
  }
  if (typeof row.shape !== "string" || row.shape.length === 0) {
    errors.push(`rows[${index}].shape must be a non-empty string`);
  }
  if (!recordOrNull(row.semanticState)) {
    errors.push(`rows[${index}].semanticState must be an object`);
  }
  rejectForbiddenRawFields(row, `rows[${index}]`, errors);
}

function rejectForbiddenRawFields(value: unknown, path: string, errors: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenRawFields(item, `${path}[${index}]`, errors));
    return;
  }
  const record = recordOrNull(value);
  if (!record) {
    return;
  }
  for (const [key, nested] of Object.entries(record)) {
    if (forbiddenRawFields.has(key)) {
      errors.push(`${path}.${key} is not allowed in semantic Node memory IR`);
    }
    rejectForbiddenRawFields(nested, `${path}.${key}`, errors);
  }
}

function refusalCodeFor(errors: string[], unsupportedCount: number): string | null {
  if (errors.length === 0) {
    return null;
  }
  return unsupportedCount > 0
    ? NODEJS_MEMORY_IR_UNSUPPORTED_REFUSAL_CODE
    : NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE;
}

function invalid(errors: string[]): NodejsMemoryIrValidationResult {
  return {
    accepted: false,
    refusalCode: NODEJS_MEMORY_IR_INVALID_REFUSAL_CODE,
    errors,
    rowCount: 0,
  };
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
