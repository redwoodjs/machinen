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
  if (
    !row.resourcePattern ||
    !row.equivalentTargetEvidence ||
    !row.fallbackPolicy ||
    !row.migrationMode ||
    !row.boundary
  ) {
    migrationErrors.push(`incomplete migration row ${JSON.stringify(row)}`);
  }
}

const requiredWave1Candidates = [
  "python-http",
  "python-http-directory",
  "nc-listener",
  "reader-cat",
  "grep",
  "tail",
];
const allowedMigrationModes = [
  "generic-primary",
  "generic-equivalent-with-bespoke-fallback",
  "bespoke-fallback-only",
  "not-migrated",
];
const requiredWave2Candidates = ["python-http-directory", "nc-listener", "reader-cat", "grep"];
const allowedWave2MigrationModes = [
  "generic-primary-candidate-pending-proof",
  "generic-primary",
  "generic-equivalent-with-bespoke-fallback",
  "bespoke-fallback-only",
  "not-migrated",
];
const allowedWave2TargetModes = [
  "generic-primary",
  "retain-bespoke-fallback",
  "bespoke-fallback-only",
  "not-migrated",
];
const requiredServiceCandidates = [
  "nginx-static",
  "caddy-static",
  "ruby-http",
  "php-static",
  "rsync-daemon",
  "redis-idle",
];
const allowedServiceMigrationModes = [
  "explicit-envelope-fallback",
  "generic-primary-pending-proof",
];
const migrationWave1Candidates = inventory.genericMigrationWave1Candidates ?? [];
const migrationWave1Errors = validateWave1Candidates(
  migrationWave1Candidates,
  migrationRows,
  proofNames,
);
const migrationWave2Candidates = inventory.genericMigrationWave2Candidates ?? [];
const migrationWave2Errors = validateWave2Candidates(
  migrationWave2Candidates,
  migrationRows,
  proofNames,
);
const serviceCandidates = inventory.genericServiceConsolidationCandidates ?? [];
const serviceConsolidationErrors = [
  ...validateServiceCandidates(serviceCandidates, proofNames),
  ...validateServiceStatusLanguage(inventory.genericServiceConsolidationStatusLanguage),
];

const requiredGenericRows = [
  "generic-yes-loop",
  "generic-finite-pipe-replay",
  "generic-long-running-pipe-pair",
  "generic-pipe-stdio-refusals",
  "generic-static-http-daemon",
  "generic-interpreted-server",
  "generic-file-backed-worker",
  "generic-readonly-file-cli",
  "generic-writable-log-daemon",
  "generic-data-dir-daemon",
  "generic-readonly-file-cursor",
  "generic-append-log-cursor",
  "generic-multi-file-readonly-worker",
  "generic-append-log-preflight-refusals",
  "generic-stale-file-identity-refusal",
  "generic-deleted-file-fd-refusal",
  "generic-writable-file-cursor-refusal",
  "generic-append-only-file-cursor-refusal",
  "generic-append-log-unsupported-flags-refusal",
  "generic-append-log-fanotify-refusal",
  "generic-file-lock-refusal",
  "generic-mmap-file-refusal",
  "generic-inotify-file-refusal",
  "generic-unix-socket-baseline-refusals",
  "generic-anon-inode-baseline-refusals",
  "generic-pty-transcript-probe",
  "generic-pty-terminal-refusals",
  "generic-service-php-static-parity",
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
    migrationMode: row.migrationMode,
  })),
  migrationWave1Candidates: migrationWave1Candidates.map((row) => ({
    bespokeProofName: row.bespokeProofName,
    genericProofName: row.genericProofName,
    migrationMode: row.migrationMode,
  })),
  migrationWave2Candidates: migrationWave2Candidates.map((row) => ({
    bespokeProofName: row.bespokeProofName,
    genericProofName: row.genericProofName,
    migrationMode: row.migrationMode,
    targetMode: row.targetMode,
  })),
  serviceConsolidationCandidates: serviceCandidates.map((row) => ({
    bespokeProofName: row.bespokeProofName,
    refusalProofName: row.refusalProofName,
    migrationMode: row.migrationMode,
    resourceClasses: row.resourceClasses,
  })),
  missing,
  extra,
  duplicates: [...new Set(duplicates)],
  missingGenericRows,
  migrationErrors,
  migrationWave1Errors,
  migrationWave2Errors,
  serviceConsolidationErrors,
};

console.log(JSON.stringify(report, null, 2));

if (
  missing.length > 0 ||
  extra.length > 0 ||
  duplicates.length > 0 ||
  missingGenericRows.length > 0 ||
  migrationErrors.length > 0 ||
  migrationWave1Errors.length > 0 ||
  migrationWave2Errors.length > 0 ||
  serviceConsolidationErrors.length > 0
) {
  process.exit(1);
}

function validateServiceStatusLanguage(statusLanguage) {
  return [
    serviceStatusFieldError(statusLanguage, "allowedClaim"),
    serviceStatusFieldError(statusLanguage, "supportScope"),
    serviceStatusFieldError(statusLanguage, "fallbackStatement"),
    serviceForbiddenClaimsError(statusLanguage),
  ].filter(Boolean);
}

function serviceStatusFieldError(statusLanguage, field) {
  return statusLanguage?.[field] ? undefined : `missing service status language ${field}`;
}

function serviceForbiddenClaimsError(statusLanguage) {
  return Array.isArray(statusLanguage?.forbiddenClaims) && statusLanguage.forbiddenClaims.length > 0
    ? undefined
    : "missing service status language forbiddenClaims";
}

function validateServiceCandidates(candidates, proofNames) {
  const candidateNames = new Set(candidates.map((row) => row.bespokeProofName).filter(Boolean));
  return [
    ...requiredServiceCandidates
      .filter((name) => !candidateNames.has(name))
      .map((name) => `missing service consolidation candidate ${name}`),
    ...candidates.flatMap((row) => validateServiceCandidate(row, proofNames)),
  ];
}

function validateServiceCandidate(row, proofNames) {
  return [
    ...serviceProofErrors(row, proofNames),
    serviceMigrationModeError(row),
    ...serviceFieldErrors(row),
    serviceResourceClassError(row),
  ].filter(Boolean);
}

function serviceProofErrors(row, proofNames) {
  return [
    serviceProofError(row.bespokeProofName, proofNames, "bespoke"),
    serviceProofError(row.refusalProofName, proofNames, "refusal"),
    ...(row.genericProofNames ?? []).map((name) => serviceProofError(name, proofNames, "generic")),
  ];
}

function serviceMigrationModeError(row) {
  return allowedServiceMigrationModes.includes(row.migrationMode)
    ? undefined
    : `invalid service migration mode ${row.bespokeProofName}:${row.migrationMode}`;
}

function serviceFieldErrors(row) {
  return [
    "serviceShape",
    "fallbackPolicy",
    "supportBoundary",
    "requiredSupportEvidence",
    "requiredRefusalEvidence",
  ].map((field) => (row[field] ? undefined : `missing service ${field} ${row.bespokeProofName}`));
}

function serviceResourceClassError(row) {
  return Array.isArray(row.resourceClasses) && row.resourceClasses.length > 0
    ? undefined
    : `missing service resourceClasses ${row.bespokeProofName}`;
}

function serviceProofError(name, proofNames, kind) {
  return name && proofNames.includes(name)
    ? undefined
    : `unknown service ${kind} proof ${name ?? "missing"}`;
}

function validateWave1Candidates(candidates, rows, proofNames) {
  const candidateNames = new Set(candidates.map((row) => row.bespokeProofName).filter(Boolean));
  const rowByBespokeName = new Map(rows.map((row) => [row.bespokeProofName, row]));
  return [
    ...missingWave1Candidates(candidateNames),
    ...candidates.flatMap((row) => validateWave1Candidate(row, rowByBespokeName, proofNames)),
  ];
}

function missingWave1Candidates(candidateNames) {
  return requiredWave1Candidates
    .filter((name) => !candidateNames.has(name))
    .map((name) => `missing wave1 candidate ${name}`);
}

function validateWave2Candidates(candidates, rows, proofNames) {
  const candidateNames = new Set(candidates.map((row) => row.bespokeProofName).filter(Boolean));
  const rowByBespokeName = new Map(rows.map((row) => [row.bespokeProofName, row]));
  return [
    ...missingWave2Candidates(candidateNames),
    ...candidates.flatMap((row) => validateWave2Candidate(row, rowByBespokeName, proofNames)),
  ];
}

function missingWave2Candidates(candidateNames) {
  return requiredWave2Candidates
    .filter((name) => !candidateNames.has(name))
    .map((name) => `missing wave2 candidate ${name}`);
}

function validateWave2Candidate(row, rowByBespokeName, proofNames) {
  const matchingRow = rowByBespokeName.get(row.bespokeProofName);
  return [
    unknownWave2BespokeProofError(row, proofNames),
    unknownWave2GenericProofError(row, proofNames),
    missingWave2EquivalenceRowError(row, matchingRow),
    invalidWave2MigrationModeError(row),
    invalidWave2TargetModeError(row),
    missingWave2FieldError(row, "fallbackPolicy"),
    missingWave2FieldError(row, "requiredEvidence"),
    missingWave2FieldError(row, "boundary"),
  ].filter(Boolean);
}

function unknownWave2BespokeProofError(row, proofNames) {
  return row.bespokeProofName && proofNames.includes(row.bespokeProofName)
    ? undefined
    : `unknown wave2 bespoke proof ${row.bespokeProofName ?? "missing"}`;
}

function unknownWave2GenericProofError(row, proofNames) {
  return row.genericProofName && proofNames.includes(row.genericProofName)
    ? undefined
    : `unknown wave2 generic proof ${row.genericProofName ?? "missing"}`;
}

function missingWave2EquivalenceRowError(row, matchingRow) {
  return matchingRow ? undefined : `missing wave2 equivalence row ${row.bespokeProofName}`;
}

function invalidWave2MigrationModeError(row) {
  return allowedWave2MigrationModes.includes(row.migrationMode)
    ? undefined
    : `invalid wave2 migration mode ${row.bespokeProofName}:${row.migrationMode}`;
}

function invalidWave2TargetModeError(row) {
  return allowedWave2TargetModes.includes(row.targetMode)
    ? undefined
    : `invalid wave2 target mode ${row.bespokeProofName}:${row.targetMode}`;
}

function missingWave2FieldError(row, field) {
  return row[field] ? undefined : `missing wave2 ${field} ${row.bespokeProofName}`;
}

function validateWave1Candidate(row, rowByBespokeName, proofNames) {
  const matchingRow = rowByBespokeName.get(row.bespokeProofName);
  return [
    unknownBespokeProofError(row, proofNames),
    invalidMigrationModeError(row),
    missingBoundaryError(row),
    missingEquivalenceRowError(row, matchingRow),
    unknownGenericProofError(row, proofNames),
    genericProofMismatchError(row, matchingRow),
    migrationModeMismatchError(row, matchingRow),
  ].filter(Boolean);
}

function unknownBespokeProofError(row, proofNames) {
  return row.bespokeProofName && proofNames.includes(row.bespokeProofName)
    ? undefined
    : `unknown wave1 bespoke proof ${row.bespokeProofName ?? "missing"}`;
}

function invalidMigrationModeError(row) {
  return allowedMigrationModes.includes(row.migrationMode)
    ? undefined
    : `invalid wave1 migration mode ${row.bespokeProofName}:${row.migrationMode}`;
}

function missingBoundaryError(row) {
  return row.boundary ? undefined : `missing wave1 boundary ${row.bespokeProofName}`;
}

function missingEquivalenceRowError(row, matchingRow) {
  return matchingRow ? undefined : `missing migration equivalence row ${row.bespokeProofName}`;
}

function unknownGenericProofError(row, proofNames) {
  return row.genericProofName && !proofNames.includes(row.genericProofName)
    ? `unknown wave1 generic proof ${row.genericProofName}`
    : undefined;
}

function genericProofMismatchError(row, matchingRow) {
  return matchingRow?.genericProofName === row.genericProofName
    ? undefined
    : `wave1 generic proof mismatch ${row.bespokeProofName}`;
}

function migrationModeMismatchError(row, matchingRow) {
  return matchingRow?.migrationMode === row.migrationMode
    ? undefined
    : `wave1 migration mode mismatch ${row.bespokeProofName}`;
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
