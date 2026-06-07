#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyNativeShape, supportedShapes } from "./detectors/native-shape-detector.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const retainedDir = join(root, "retained");
const proofRoot = join(root, "..", "native-binary-shape-proofs", "retained");
const shapes = Object.keys(supportedShapes);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function assertAccepted(shape, label, ir) {
  const result = classifyNativeShape(shape, ir);
  if (result.decision !== "accepted") {
    throw new Error(`${shape} ${label} should accept: ${result.refusalCode}`);
  }
  return result;
}
function assertRefused(shape, label, ir) {
  const result = classifyNativeShape(shape, ir);
  if (result.decision !== "refused") {
    throw new Error(`${shape} ${label} should refuse`);
  }
  return result;
}
function refusalFixtures(base) {
  return [
    ["missing-safe-point", (ir) => void (ir.safePoint = "missing")],
    ["bad-entry-symbol", (ir) => void (ir.entrySymbol = "unknown")],
    ["same-architecture", (ir) => void (ir.targetArch = ir.sourceArch)],
    ["source-isa-emulation", (ir) => void (ir.claimGuard.sourceIsaEmulationUsed = true)],
    ["metadata-only", (ir) => void (ir.claimGuard.metadataOnlySuccess = true)],
    ["active-syscall", (ir) => void (ir.activeSyscall = true)],
    ["thread-state", (ir) => void (ir.hasThreads = true)],
    ["socket-state", (ir) => void (ir.hasSocket = true)],
    ["descriptor-thread", (ir) => void (ir.shapeDescriptor.threads = 2)],
  ].map(([label, mutate]) => {
    const ir = clone(base);
    mutate(ir);
    return [label, ir];
  });
}

mkdirSync(retainedDir, { recursive: true });
const reports = [];
for (const shape of shapes) {
  const accepted = [];
  for (const direction of ["arm64-to-amd64", "amd64-to-arm64"]) {
    const result = assertAccepted(
      shape,
      direction,
      readJson(join(proofRoot, `${shape}-${direction}.ir.json`)),
    );
    writeJson(join(retainedDir, `${shape}-detector-accepted-${direction}.json`), result);
    accepted.push({
      label: direction,
      decision: result.decision,
      supportStage: result.supportStage,
    });
  }
  const base = readJson(join(proofRoot, `${shape}-arm64-to-amd64.ir.json`));
  const refused = refusalFixtures(base).map(([label, ir]) => {
    const result = assertRefused(shape, label, ir);
    writeJson(join(retainedDir, `${shape}-detector-refused-${label}.json`), result);
    return { label, decision: result.decision, refusalCode: result.refusalCode };
  });
  const report = {
    kind: "machinen.research.native-binary-refusal.native-shape-detector-report",
    version: 1,
    row: shape,
    lifecycleStage: "4-supported-subset",
    supportDecision: "supported-subset",
    supportScope: supportedShapes[shape],
    accepted,
    refused,
    claimGuard: {
      arbitraryProcessRestoreClaimed: false,
      rawVmReplayUsed: false,
      sourceIsaEmulationUsed: false,
      metadataOnlySuccess: false,
    },
    status: "passed",
  };
  writeJson(join(retainedDir, `${shape}-detector-report.json`), report);
  reports.push(report);
}
const summary = {
  kind: "machinen.research.native-binary-refusal.native-shape-detectors-summary",
  version: 1,
  supportedSubsetRows: shapes.length,
  rows: reports.map((report) => ({
    row: report.row,
    status: report.status,
    supportScope: report.supportScope,
  })),
  status: "passed",
};
writeJson(join(retainedDir, "native-shape-detectors-summary.json"), summary);
console.log(JSON.stringify(summary, null, 2));
