#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const matrixPath = resolve(here, "continuation-matrix.json");
const outPath = resolve(here, "retained/report.json");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isFalseOrAbsent(value) {
  return value === false || value === undefined;
}

function rowFromReport(report, proofCase) {
  if (!proofCase) {
    return report;
  }
  const row = report.rows?.find(
    (candidate) => candidate.case === proofCase || candidate.id === proofCase,
  );
  if (!row) {
    throw new Error(`proofCase ${proofCase} was not found in ${report.kind ?? "report"}`);
  }
  return row;
}

function hasDirection(row, direction, decision) {
  return row.directions?.some(
    (entry) =>
      entry.direction === direction &&
      entry.decision === decision &&
      entry.sourceArch &&
      entry.targetArch,
  );
}

function validateEvidenceRow(matrix, row) {
  const reportPath = resolve(repo, row.proofReport);
  const report = readJson(reportPath);
  const evidence = rowFromReport(report, row.proofCase);
  const claimGuard = report.claimGuard ?? evidence.claimGuard;
  const errors = [];

  if (!claimGuard) {
    errors.push("missing claimGuard");
  } else {
    for (const key of matrix.requiredClaimGuardFalse) {
      if (!isFalseOrAbsent(claimGuard[key])) {
        errors.push(`claimGuard.${key} must be false or absent`);
      }
    }
  }

  const expected = row.decision === "refused" ? "refused" : "accepted";
  if (evidence.sameArch !== expected) {
    errors.push(`sameArch must be ${expected}; got ${evidence.sameArch}`);
  }
  for (const direction of ["amd64-to-arm64", "arm64-to-amd64"]) {
    if (!hasDirection(evidence, direction, expected)) {
      errors.push(`missing ${direction} ${expected} source+target evidence`);
    }
  }
  if (row.decision !== "refused" && evidence.status === "skipped-not-installed") {
    errors.push("supported row must not be skipped");
  }
  if (row.decision !== "refused" && evidence.status && evidence.status !== "accepted") {
    errors.push(`supported row status must be accepted; got ${evidence.status}`);
  }
  if (row.decision === "refused" && evidence.status && evidence.status !== "refused") {
    errors.push(`refusal row status must be refused; got ${evidence.status}`);
  }

  return {
    id: row.id,
    proofBinary: row.proofBinary,
    proofCase: row.proofCase,
    decision: row.decision,
    shape: row.shape,
    proofReport: row.proofReport,
    evidenceStatus: evidence.status ?? expected,
    sameArch: evidence.sameArch,
    directions: evidence.directions ?? [],
    valid: errors.length === 0,
    errors,
  };
}

function validateClassifier(matrix) {
  if (!matrix.classifier) {
    return { valid: false, errors: ["missing classifier section"] };
  }
  const classifierReport = readJson(resolve(repo, matrix.classifier.report));
  const errors = [];
  if (classifierReport.status !== "passed") {
    errors.push(`classifier report status must be passed; got ${classifierReport.status}`);
  }
  const reports = classifierReport.reports ?? [];
  const shapeIdsByHost = reports.map((hostReport) => ({
    hostArch: hostReport.hostArch,
    shapeIds: new Set(hostReport.rows?.map((row) => row.result?.shapeId).filter(Boolean) ?? []),
  }));
  for (const hostReport of reports) {
    for (const row of hostReport.rows ?? []) {
      const result = row.result ?? {};
      if (result.decision === "accepted" && !result.descriptor) {
        errors.push(
          `classifier host ${hostReport.hostArch} accepted ${row.name} without descriptor`,
        );
      }
      if (
        result.decision === "accepted" &&
        result.descriptor?.memory?.rawHeapStackRegistersCaptured !== false
      ) {
        errors.push(
          `classifier host ${hostReport.hostArch} descriptor for ${row.name} does not deny raw heap/stack/register capture`,
        );
      }
      if (result.decision === "accepted" && result.descriptor?.architectureNeutral !== true) {
        errors.push(
          `classifier host ${hostReport.hostArch} descriptor for ${row.name} is not architecture-neutral`,
        );
      }
      if (result.decision === "refused" && result.descriptor) {
        errors.push(
          `classifier host ${hostReport.hostArch} refused ${row.name} but emitted a descriptor`,
        );
      }
    }
  }
  for (const requiredShapeId of matrix.classifier.requiredShapeIds ?? []) {
    for (const host of shapeIdsByHost) {
      if (!host.shapeIds.has(requiredShapeId)) {
        errors.push(`classifier host ${host.hostArch} missing shapeId ${requiredShapeId}`);
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    report: matrix.classifier.report,
    hosts: shapeIdsByHost.map((host) => host.hostArch),
    requiredShapeIds: matrix.classifier.requiredShapeIds ?? [],
  };
}

const matrix = readJson(matrixPath);
const rows = matrix.rows.map((row) => validateEvidenceRow(matrix, row));
const classifier = validateClassifier(matrix);
const failedRows = rows.filter((row) => !row.valid);
if (!classifier.valid) {
  failedRows.push({ id: "classifier", errors: classifier.errors });
}
const report = {
  kind: "machinen.research.native-continuation-shape-matrix.report",
  version: 1,
  status: failedRows.length === 0 ? "passed" : "failed",
  rowCount: rows.length,
  supportedRows: rows.filter((row) => row.decision !== "refused").length,
  refusedRows: rows.filter((row) => row.decision === "refused").length,
  failedRows: failedRows.length,
  axis: "cpu-memory-resource-shape-not-proof-binary",
  classifier,
  rows,
};
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      status: report.status,
      rowCount: report.rowCount,
      supportedRows: report.supportedRows,
      refusedRows: report.refusedRows,
      failedRows: report.failedRows,
    },
    null,
    2,
  ),
);
if (failedRows.length) {
  process.exit(1);
}
