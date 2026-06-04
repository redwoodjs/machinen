export const NODEJS_RESOURCE_IR_KIND = "machinen.nodejs.resource-ir";
export const NODEJS_RESOURCE_IR_VERSION = 1;
export const NODEJS_RESOURCE_IR_RESTORE_STRATEGY = "materialize-nodejs-resource-ir-target-native";
export const NODEJS_RESOURCE_IR_MATERIALIZER_FILENAME = "nodejs-resource-materializer.mjs";
export const NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE = "node-portability-resource-ir-invalid";
export const NODEJS_RESOURCE_IR_UNSUPPORTED_REFUSAL_CODE =
  "node-portability-resource-ir-unsupported";

export interface NodejsResourceIrRow {
  id: string;
  kind: string;
  semanticState: Record<string, unknown>;
  reconstructable: true;
  captureBoundaryId: "portable-vm-pause-boundary.json";
  pausedEvidence: {
    sourceVmPaused: true;
    evidenceArtifact: "portable-vm-pause-boundary.json";
  };
  materializationPolicy: "target-native-reconstruct";
}

export interface NodejsResourceIrDocument {
  kind: typeof NODEJS_RESOURCE_IR_KIND;
  version: typeof NODEJS_RESOURCE_IR_VERSION;
  runtime?: Record<string, unknown>;
  captureBoundary: {
    sourceVmPauseRequired: true;
    stabilityPoint: "source-vm-paused";
    unsupportedPausedLiveStatePolicy: "refuse";
  };
  rows: NodejsResourceIrRow[];
  unsupported?: Array<{ code?: string; reason?: string }>;
  claimGuard?: Record<string, unknown>;
}

export interface NodejsResourceIrValidationResult {
  accepted: boolean;
  refusalCode: string | null;
  errors: string[];
  rowCount: number;
}

const supportedResourceKinds = new Set([
  "timer-schedule-spec",
  "reopenable-file-spec",
  "http-listener-route-spec",
  "drained-stream-buffer-spec",
  "route-registry-spec",
  "middleware-registry-spec",
  "configured-outbound-client-spec",
  "signal-handler-registry-spec",
  "immediate-schedule-spec",
  "unref-timer-schedule-spec",
  "ttl-cache-expiration-spec",
  "cache-expiration-timer-spec",
  "timer-backed-refill-spec",
  "drained-readable-stream-spec",
  "drained-writable-stream-spec",
  "pipeline-drained-state-spec",
  "reopenable-read-stream-spec",
  "reopenable-write-stream-spec",
  "timer-wheel-state-spec",
  "delayed-queue-schedule-spec",
  "monotonic-clock-baseline-spec",
  "performance-timing-baseline-spec",
  "active-refresh-schedule-spec",
  "reopenable-dir-handle-spec",
  "fs-watcher-subscription-spec",
  "transform-stream-drained-state-spec",
  "backpressure-buffer-drained-spec",
  "stream-backed-logger-sink-spec",
  "log-transport-drained-spec",
  "zlib-stream-drained-state-spec",
  "brotli-stream-drained-state-spec",
  "inflate-stream-drained-state-spec",
  "deflate-stream-drained-state-spec",
  "write-ahead-buffer-flushed-spec",
]);

const forbiddenRawFields = new Set([
  "rawFd",
  "fd",
  "pid",
  "samePid",
  "nativeHandle",
  "uvHandle",
  "socketHandle",
  "tlsSessionBytes",
  "rawV8Heap",
  "rawCpuState",
  "sourceIsaEmulation",
]);

export function validateNodejsResourceIrDocument(value: unknown): NodejsResourceIrValidationResult {
  const errors: string[] = [];
  const doc = recordOrNull(value);
  if (!doc) {
    return invalid(["Node resource IR must be a JSON object"]);
  }
  if (doc.kind !== NODEJS_RESOURCE_IR_KIND) {
    errors.push(`kind must be ${NODEJS_RESOURCE_IR_KIND}`);
  }
  if (doc.version !== NODEJS_RESOURCE_IR_VERSION) {
    errors.push(`version must be ${NODEJS_RESOURCE_IR_VERSION}`);
  }
  rejectForbiddenRawFields(doc, "$", errors);
  validateNodejsResourceIrCaptureBoundary(doc.captureBoundary, errors);
  const unsupported = Array.isArray(doc.unsupported) ? doc.unsupported : [];
  if (unsupported.length > 0) {
    errors.push("unsupported Node resource IR entries must refuse before materialization");
  }
  if (!Array.isArray(doc.rows)) {
    errors.push("rows must be an array");
  } else {
    doc.rows.forEach((row, index) => validateNodejsResourceIrRow(row, index, errors));
  }
  return {
    accepted: errors.length === 0,
    refusalCode: refusalCodeFor(errors, unsupported.length),
    errors,
    rowCount: Array.isArray(doc.rows) ? doc.rows.length : 0,
  };
}

// fallow-ignore-next-line code-duplication
export function createNodejsResourceIrMaterializerModule(): string {
  return `#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const KIND = ${JSON.stringify(NODEJS_RESOURCE_IR_KIND)};
const VERSION = ${JSON.stringify(NODEJS_RESOURCE_IR_VERSION)};
const supportedResourceKinds = new Set(${JSON.stringify([...supportedResourceKinds])});
const forbiddenRawFields = new Set(${JSON.stringify([...forbiddenRawFields])});
const args = parseArgs(process.argv.slice(2));
const ir = JSON.parse(readFileSync(args.ir, "utf8"));
const validation = validate(ir);
if (!validation.accepted) {
  console.error(JSON.stringify({ accepted: false, refusalCode: validation.refusalCode, errors: validation.errors }));
  process.exit(2);
}
const rows = ir.rows.map((row) => ({ id: row.id, kind: row.kind, semanticState: row.semanticState }));
mkdirSync(args.targetDir, { recursive: true });
writeFileSync(join(args.targetDir, "node-resource-rows.json"), JSON.stringify(rows, null, 2) + "\\n");
writeFileSync(join(args.targetDir, "node-resource-ir-summary.json"), JSON.stringify({ kind: ir.kind, version: ir.version, materializedRows: rows.length, rowIds: rows.map((row) => row.id) }, null, 2) + "\\n");
writeFileSync(join(args.targetDir, "node-resource-app.mjs"), targetAppSource(rows, args.port));
console.log(JSON.stringify({ accepted: true, materializedRows: rows.length, rowIds: rows.map((row) => row.id), app: join(args.targetDir, "node-resource-app.mjs"), rows: join(args.targetDir, "node-resource-rows.json"), claimGuard: claimGuard() }));

function parseArgs(argv) {
  let ir = "/mnt/capture/nodejs-resource-ir.json";
  let targetDir = "/opt/machinen-all3";
  let port = 18183;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--ir") {
      ir = argv[++index] ?? ir;
    } else if (arg === "--target-dir") {
      targetDir = argv[++index] ?? targetDir;
    } else if (arg === "--port") {
      port = Number(argv[++index] ?? port);
    } else {
      throw new Error(\`unknown argument \${arg}\`);
    }
  }
  assert(Number.isInteger(port) && port > 0, "--port must be a positive integer");
  return { ir: resolve(ir), targetDir: resolve(targetDir), port };
}

function targetAppSource(rows, port) {
  return \`import http from "node:http";\nconst rows = \${JSON.stringify(rows)};\nglobalThis.__machinenMaterializedNodeResourceRows = rows;\nhttp.createServer((req, res) => {\n  if (req.url === "/resources") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(rows)); return; }\n  if (req.url === "/value") { res.end("resources-ready"); return; }\n  res.writeHead(404); res.end("not found");\n}).listen(\${JSON.stringify(port)}, "127.0.0.1");\n\`;
}

function validate(value) {
  const errors = [];
  if (!isRecord(value)) {
    return { accepted: false, refusalCode: ${JSON.stringify(NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE)}, errors: ["Node resource IR must be a JSON object"] };
  }
  if (value.kind !== KIND) {
    errors.push(\`kind must be \${KIND}\`);
  }
  if (value.version !== VERSION) {
    errors.push(\`version must be \${VERSION}\`);
  }
  rejectForbiddenRawFields(value, "$", errors);
  validateCaptureBoundary(value.captureBoundary, errors);
  const unsupported = Array.isArray(value.unsupported) ? value.unsupported : [];
  if (unsupported.length > 0) {
    errors.push("unsupported Node resource IR entries must refuse before materialization");
  }
  if (!Array.isArray(value.rows)) {
    errors.push("rows must be an array");
  } else {
    value.rows.forEach((row, index) => validateRow(row, index, errors));
  }
  return { accepted: errors.length === 0, refusalCode: refusalCodeFor(errors, unsupported.length), errors };
}

function validateCaptureBoundary(value, errors) {
  if (!isRecord(value)) {
    errors.push("captureBoundary must be an object");
    return;
  }
  if (value.sourceVmPauseRequired !== true) {
    errors.push("captureBoundary.sourceVmPauseRequired must be true");
  }
  if (value.stabilityPoint !== "source-vm-paused") {
    errors.push("captureBoundary.stabilityPoint must be source-vm-paused");
  }
  if (value.unsupportedPausedLiveStatePolicy !== "refuse") {
    errors.push("captureBoundary.unsupportedPausedLiveStatePolicy must be refuse");
  }
}

function validatePausedEvidence(value, index, errors) {
  if (!isRecord(value)) {
    errors.push(\`rows[\${index}].pausedEvidence must be an object\`);
    return;
  }
  if (value.sourceVmPaused !== true) {
    errors.push(\`rows[\${index}].pausedEvidence.sourceVmPaused must be true\`);
  }
  if (value.evidenceArtifact !== "portable-vm-pause-boundary.json") {
    errors.push(\`rows[\${index}].pausedEvidence.evidenceArtifact must reference portable-vm-pause-boundary.json\`);
  }
}

function validateRow(row, index, errors) {
  if (!isRecord(row)) {
    errors.push(\`rows[\${index}] must be an object\`);
    return;
  }
  if (typeof row.id !== "string" || row.id.length === 0) {
    errors.push(\`rows[\${index}].id must be a non-empty string\`);
  }
  if (typeof row.kind !== "string" || !supportedResourceKinds.has(row.kind)) {
    errors.push(\`rows[\${index}].kind must be a supported resource kind\`);
  }
  if (row.reconstructable !== true) {
    errors.push(\`rows[\${index}].reconstructable must be true\`);
  }
  if (row.captureBoundaryId !== "portable-vm-pause-boundary.json") {
    errors.push(\`rows[\${index}].captureBoundaryId must reference portable-vm-pause-boundary.json\`);
  }
  validatePausedEvidence(row.pausedEvidence, index, errors);
  if (row.materializationPolicy !== "target-native-reconstruct") {
    errors.push(\`rows[\${index}].materializationPolicy must be target-native-reconstruct\`);
  }
  if (!isRecord(row.semanticState)) {
    errors.push(\`rows[\${index}].semanticState must be an object\`);
  }
  rejectForbiddenRawFields(row, \`rows[\${index}]\`, errors);
}

function rejectForbiddenRawFields(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenRawFields(item, \`\${path}[\${index}]\`, errors));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenRawFields.has(key)) {
      errors.push(\`\${path}.\${key} is not allowed in semantic Node resource IR\`);
    }
    rejectForbiddenRawFields(nested, \`\${path}.\${key}\`, errors);
  }
}

function refusalCodeFor(errors, unsupportedCount) {
  if (errors.length === 0) {
    return null;
  }
  return unsupportedCount > 0 ? ${JSON.stringify(NODEJS_RESOURCE_IR_UNSUPPORTED_REFUSAL_CODE)} : ${JSON.stringify(NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE)};
}
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function claimGuard() { return { arbitraryNodeProcessRestoreClaimed: false, rawV8HeapRestoreUsed: false, samePidContinuationClaimed: false, rawCpuStateReplayUsed: false, sourceIsaEmulationUsed: false, rawNativeHandleRestoreUsed: false }; }
`;
}

// fallow-ignore-next-line code-duplication
function validateNodejsResourceIrCaptureBoundary(value: unknown, errors: string[]): void {
  const boundary = recordOrNull(value);
  if (!boundary) {
    errors.push("captureBoundary must be an object");
    return;
  }
  if (boundary.sourceVmPauseRequired !== true) {
    errors.push("captureBoundary.sourceVmPauseRequired must be true");
  }
  if (boundary.stabilityPoint !== "source-vm-paused") {
    errors.push("captureBoundary.stabilityPoint must be source-vm-paused");
  }
  if (boundary.unsupportedPausedLiveStatePolicy !== "refuse") {
    errors.push("captureBoundary.unsupportedPausedLiveStatePolicy must be refuse");
  }
}

// fallow-ignore-next-line code-duplication
function validateNodejsResourceIrPausedEvidence(
  value: unknown,
  index: number,
  errors: string[],
): void {
  const evidence = recordOrNull(value);
  if (!evidence) {
    errors.push(`rows[${index}].pausedEvidence must be an object`);
    return;
  }
  if (evidence.sourceVmPaused !== true) {
    errors.push(`rows[${index}].pausedEvidence.sourceVmPaused must be true`);
  }
  if (evidence.evidenceArtifact !== "portable-vm-pause-boundary.json") {
    errors.push(
      `rows[${index}].pausedEvidence.evidenceArtifact must reference portable-vm-pause-boundary.json`,
    );
  }
}

function validateNodejsResourceIrRow(value: unknown, index: number, errors: string[]): void {
  const row = recordOrNull(value);
  if (!row) {
    errors.push(`rows[${index}] must be an object`);
    return;
  }
  if (typeof row.id !== "string" || row.id.length === 0) {
    errors.push(`rows[${index}].id must be a non-empty string`);
  }
  if (typeof row.kind !== "string" || !supportedResourceKinds.has(row.kind)) {
    errors.push(`rows[${index}].kind must be a supported resource kind`);
  }
  if (row.reconstructable !== true) {
    errors.push(`rows[${index}].reconstructable must be true`);
  }
  if (row.captureBoundaryId !== "portable-vm-pause-boundary.json") {
    errors.push(`rows[${index}].captureBoundaryId must reference portable-vm-pause-boundary.json`);
  }
  validateNodejsResourceIrPausedEvidence(row.pausedEvidence, index, errors);
  if (row.materializationPolicy !== "target-native-reconstruct") {
    errors.push(`rows[${index}].materializationPolicy must be target-native-reconstruct`);
  }
  if (!recordOrNull(row.semanticState)) {
    errors.push(`rows[${index}].semanticState must be an object`);
  }
  rejectForbiddenRawFields(row, `rows[${index}]`, errors);
}

// fallow-ignore-next-line code-duplication
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
      errors.push(`${path}.${key} is not allowed in semantic Node resource IR`);
    }
    rejectForbiddenRawFields(nested, `${path}.${key}`, errors);
  }
}

function refusalCodeFor(errors: string[], unsupportedCount: number): string | null {
  if (errors.length === 0) {
    return null;
  }
  return unsupportedCount > 0
    ? NODEJS_RESOURCE_IR_UNSUPPORTED_REFUSAL_CODE
    : NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE;
}

function invalid(errors: string[]): NodejsResourceIrValidationResult {
  return {
    accepted: false,
    refusalCode: NODEJS_RESOURCE_IR_INVALID_REFUSAL_CODE,
    errors,
    rowCount: 0,
  };
}

// fallow-ignore-next-line code-duplication
function recordOrNull(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
