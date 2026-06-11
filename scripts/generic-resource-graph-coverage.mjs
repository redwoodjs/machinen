#!/usr/bin/env node
import { readFileSync } from "node:fs";

const matrixPath =
  process.env.GENERIC_RESOURCE_GRAPH_MATRIX ?? "scripts/smoke/move-envelope-matrix.sh";
const inventoryPath =
  process.env.GENERIC_RESOURCE_GRAPH_INVENTORY ??
  "docs/snapshot/generic-resource-graph-inventory.json";

const matrix = readFileSync(matrixPath, "utf8");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));

const proofNames = extractShellArray(matrix, "PROOF_NAMES");
const inventoryNames = inventory.families.flatMap((family) => family.proofNames ?? []);
const missing = difference(proofNames, inventoryNames);
const extra = difference(inventoryNames, proofNames);
const duplicates = inventoryNames.filter((name, index) => inventoryNames.indexOf(name) !== index);

const genericFamilies = inventory.families.filter((family) =>
  family.proofNames?.some((name) => name.startsWith("generic-")),
);
const genericProofNames = genericFamilies.flatMap((family) => family.proofNames ?? []);
const migrationRows = inventory.genericMigrationEquivalence ?? [];
const migrationErrors = [];
for (const row of migrationRows) {
  if (!proofNames.includes(row.bespokeProofName)) {
    migrationErrors.push(`unknown bespoke proof ${row.bespokeProofName}`);
  }
  if (!proofNames.includes(row.genericProofName)) {
    migrationErrors.push(`unknown generic proof ${row.genericProofName}`);
  }
  if (!row.resourcePattern || !row.equivalentTargetEvidence || !row.fallbackPolicy) {
    migrationErrors.push(`incomplete migration row ${JSON.stringify(row)}`);
  }
}

const requiredGenericRows = [
  "generic-yes-loop",
  "generic-static-http-daemon",
  "generic-interpreted-server",
  "generic-file-backed-worker",
  "generic-readonly-file-cli",
  "generic-writable-log-daemon",
  "generic-data-dir-daemon",
  "generic-unsupported-resource-refusals",
  "generic-loader-preflight-refusals",
];
const missingGenericRows = requiredGenericRows.filter((name) => !proofNames.includes(name));

const report = {
  matrixProofNames: proofNames.length,
  inventoryProofNames: inventoryNames.length,
  genericProofNames,
  migrationEquivalence: migrationRows.map((row) => ({
    bespokeProofName: row.bespokeProofName,
    genericProofName: row.genericProofName,
    resourcePattern: row.resourcePattern,
  })),
  missing,
  extra,
  duplicates: [...new Set(duplicates)],
  missingGenericRows,
  migrationErrors,
};

console.log(JSON.stringify(report, null, 2));

if (
  missing.length > 0 ||
  extra.length > 0 ||
  duplicates.length > 0 ||
  missingGenericRows.length > 0 ||
  migrationErrors.length > 0
) {
  process.exit(1);
}

function extractShellArray(source, name) {
  const match = new RegExp(`${name}=\\((?<body>[\\s\\S]*?)\\)`).exec(source);
  if (!match?.groups?.body) {
    throw new Error(`missing ${name}`);
  }
  return match.groups.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}
