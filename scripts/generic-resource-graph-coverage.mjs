#!/usr/bin/env node
import { readFileSync } from "node:fs";

const matrixPath =
  process.env.GENERIC_RESOURCE_GRAPH_MATRIX ?? "scripts/smoke/move-envelope-matrix.sh";
const inventoryPath =
  process.env.GENERIC_RESOURCE_GRAPH_INVENTORY ??
  "docs/snapshot/generic-resource-graph-inventory.json";

const matrix = readFileSync(matrixPath, "utf8");
const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
const documentation = {
  frontier: readFileSync(
    process.env.GENERIC_RESOURCE_GRAPH_FRONTIER_DOC ??
      "docs/snapshot/generic-resource-graph-frontier.md",
    "utf8",
  ),
  move: readFileSync(
    process.env.GENERIC_RESOURCE_GRAPH_MOVE_DOC ?? "docs/snapshot/generic-resource-graph-move.md",
    "utf8",
  ),
  readme: readFileSync(process.env.SNAPSHOT_README_DOC ?? "docs/snapshot/README.md", "utf8"),
};

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
  "generic-primary",
];
const allowedServiceProductPathModes = [
  "explicit-envelope-fallback",
  "exact-live-marker-gated",
  "blocked-by-live-generic-refusals",
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
const serviceRefusalClassRows = inventory.genericServiceRefusalClasses ?? [];
const liveProductPathCandidates = inventory.genericLiveProductPathCandidates ?? [];
const liveProductPathErrors = validateLiveProductPathCandidates(
  liveProductPathCandidates,
  proofNames,
);
const serviceConsolidationErrors = [
  ...validateServiceCandidates(serviceCandidates, proofNames),
  ...validateServiceStatusLanguage(inventory.genericServiceConsolidationStatusLanguage),
  ...validateServiceRefusalClasses(serviceRefusalClassRows, proofNames),
];

const requiredGenericRows = [
  "generic-yes-loop",
  "generic-finite-pipe-replay",
  "generic-finite-pipe-buffer-replay",
  "generic-stdio-pipe-product-marker",
  "generic-two-process-pipe-reexec",
  "generic-long-running-pipe-pair",
  "generic-pipe-stdio-refusals",
  "generic-multi-process-pipe-refusals",
  "generic-process-tree-refusals",
  "generic-service-process-tree-prefork",
  "generic-service-process-tree-refusals",
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
  "generic-file-lock-advisory",
  "generic-file-lock-refusal",
  "generic-file-lock-refusals",
  "generic-mmap-file-refusal",
  "generic-inotify-file-follow",
  "generic-inotify-fanotify-refusals",
  "generic-inotify-file-refusal",
  "generic-mmap-file-backed-clean",
  "generic-mmap-dirty-refusals",
  "generic-unix-socket-baseline-refusals",
  "generic-anon-inode-baseline-refusals",
  "generic-epoll-timerfd-watch",
  "generic-timerfd-relative-oneshot",
  "generic-timerfd-relative-oneshot-refusals",
  "generic-signalfd-signal-state-refusals",
  "generic-pty-transcript-probe",
  "generic-pty-terminal-refusals",
  "generic-service-nginx-static-parity",
  "nginx-live-generic-primary-marker",
  "service-managed-child-worker-refusal",
  "generic-service-caddy-static-parity",
  "caddy-live-generic-primary-marker",
  "caddy-live-reverse-proxy-marker-refusal",
  "generic-service-ruby-http-parity",
  "ruby-live-generic-primary-marker",
  "ruby-live-runtime-marker-refusal",
  "generic-service-rsync-daemon-parity",
  "rsync-live-generic-primary-marker",
  "rsync-live-write-marker-refusal",
  "service-config-drift-refusal",
  "service-target-package-missing-normalization",
  "service-per-service-drift-refusals",
  "generic-service-redis-idle-parity",
  "generic-database-data-dir-refusals",
  "generic-same-arch-modeled-continuation",
  "generic-same-arch-continuation-refusals",
  "generic-cross-arch-semantic-reconstruction",
  "generic-cross-arch-semantic-refusals",
  "redis-live-generic-primary-marker",
  "redis-live-nonempty-marker-refusal",
  "php-live-stdio-log-fd-refusal",
  "php-live-zend-semaphore-refusal",
  "php-live-socket-fd-refusal",
  "generic-service-php-static-parity",
  "generic-unsupported-resource-refusals",
  "generic-loader-preflight-refusals",
];
const missingGenericRows = requiredGenericRows.filter((name) => !proofNames.includes(name));
const inventoryResourceClassErrors = validateInventoryResourceClasses(inventory, proofNames);
const documentationBoundaryErrors = validateDocumentationBoundary(documentation);

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
  serviceRefusalClasses: serviceRefusalClassRows.map((row) => ({
    resourceClass: row.resourceClass,
    proofNames: row.proofNames,
  })),
  liveProductPathCandidates: liveProductPathCandidates.map((row) => ({
    productProofName: row.productProofName,
    supportProofName: row.supportProofName,
    productPathMode: row.productPathMode,
    productPathObservedGraph: row.productPathObservedGraph,
  })),
  missing,
  extra,
  duplicates: [...new Set(duplicates)],
  missingGenericRows,
  migrationErrors,
  migrationWave1Errors,
  migrationWave2Errors,
  serviceConsolidationErrors,
  liveProductPathErrors,
  inventoryResourceClassCoverage: inventoryResourceClassSummary(inventory),
  inventoryResourceClassErrors,
  documentationBoundaryErrors,
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
  serviceConsolidationErrors.length > 0 ||
  liveProductPathErrors.length > 0 ||
  inventoryResourceClassErrors.length > 0 ||
  documentationBoundaryErrors.length > 0
) {
  process.exit(1);
}

function validateLiveProductPathCandidates(rows, proofNames) {
  const required = [
    "generic-stdio-pipe-product-marker",
    "node-static-http-live-generic-primary-marker",
    "go-static-http-live-generic-primary-marker",
    "rust-static-http-live-generic-primary-marker",
    "busybox-httpd-live-generic-primary-marker",
    "busybox-nc-listener-live-generic-primary-marker",
    "socat-file-responder-live-generic-primary-marker",
    "unix-pathname-listener-live-generic-primary-marker",
    "reader-cat-live-generic-primary-marker",
    "grep-live-generic-primary-marker",
    "tail-live-generic-primary-marker",
  ];
  const byProof = new Map(rows.map((row) => [row.productProofName, row]));
  return [
    ...required
      .filter((name) => !byProof.has(name))
      .map((name) => `missing live productPath candidate ${name}`),
    ...rows.flatMap((row) => liveProductPathCandidateErrors(row, proofNames)),
  ];
}

function liveProductPathCandidateErrors(row, proofNames) {
  return [
    liveProductPathProofNameError(row, proofNames),
    liveProductPathSupportProofNameError(row, proofNames),
    ...liveProductPathRefusalProofNameErrors(row, proofNames),
    liveProductPathModeError(row),
    liveProductPathObservedGraphError(row),
    liveProductPathBoundaryError(row),
  ].filter(Boolean);
}

function liveProductPathProofNameError(row, proofNames) {
  return liveProductPathKnownProofError(row, proofNames) ?? liveProductPathMarkerSuffixError(row);
}

function liveProductPathKnownProofError(row, proofNames) {
  const name = row.productProofName;
  return name && proofNames.includes(name)
    ? undefined
    : `live productPath candidate missing known marker proof ${name ?? "<missing>"}`;
}

function liveProductPathMarkerSuffixError(row) {
  const name = row.productProofName ?? "";
  return liveProductPathMarkerName(name)
    ? undefined
    : `live productPath candidate proof is not a live marker ${name}`;
}

function liveProductPathMarkerName(name) {
  return name.includes("-live-generic-primary-marker") || name.endsWith("-product-marker");
}

function liveProductPathSupportProofNameError(row, proofNames) {
  const name = row.supportProofName;
  return name && proofNames.includes(name)
    ? undefined
    : `live productPath ${row.productProofName ?? "<missing>"} missing known support proof`;
}

function liveProductPathRefusalProofNameErrors(row, proofNames) {
  const names = row.refusalProofNames;
  if (!Array.isArray(names) || names.length === 0) {
    return [`live productPath ${row.productProofName ?? "<missing>"} missing refusal proofs`];
  }
  return names
    .filter((name) => !proofNames.includes(name))
    .map(
      (name) =>
        `live productPath ${row.productProofName ?? "<missing>"} unknown refusal proof ${name}`,
    );
}

function liveProductPathModeError(row) {
  return row.productPathMode === "exact-live-marker-gated"
    ? undefined
    : `live productPath ${row.productProofName ?? "<missing>"} invalid mode ${row.productPathMode}`;
}

function liveProductPathObservedGraphError(row) {
  return row.productPathObservedGraph === "exact-live-resource-graph"
    ? undefined
    : `live productPath ${row.productProofName ?? "<missing>"} missing exact observed graph`;
}

function liveProductPathBoundaryError(row) {
  return row.boundary && row.nonClaim
    ? undefined
    : `live productPath ${row.productProofName ?? "<missing>"} missing boundary/nonClaim`;
}

function validateServiceRefusalClasses(rows, proofNames) {
  const required = ["serviceConfigDrift", "targetPackageMissing"];
  const rowByClass = new Map(rows.map((row) => [row.resourceClass, row]));
  return required.flatMap((resourceClass) =>
    serviceRefusalClassErrors(resourceClass, rowByClass.get(resourceClass), proofNames),
  );
}

function serviceRefusalClassErrors(resourceClass, row, proofNames) {
  const errors = [];
  appendResourceClassDefinitionError(errors, resourceClass);
  appendServiceRefusalRowErrors(errors, resourceClass, row);
  appendUnknownServiceRefusalProofErrors(errors, resourceClass, row?.proofNames, proofNames);
  return errors;
}

function appendResourceClassDefinitionError(errors, resourceClass) {
  if (!inventory.resourceClasses?.[resourceClass]) {
    errors.push(`missing resourceClass definition ${resourceClass}`);
  }
}

function appendServiceRefusalRowErrors(errors, resourceClass, row) {
  if (!row) {
    errors.push(`missing service refusal class row ${resourceClass}`);
    return;
  }
  appendServiceRefusalBoundaryError(errors, resourceClass, row);
  appendServiceRefusalProofNamesError(errors, resourceClass, row.proofNames);
}

function appendServiceRefusalBoundaryError(errors, resourceClass, row) {
  if (!row.boundary) {
    errors.push(`missing service refusal class boundary ${resourceClass}`);
  }
}

function appendServiceRefusalProofNamesError(errors, resourceClass, proofNames) {
  const hasProofNames = Array.isArray(proofNames) && proofNames.length > 0;
  if (!hasProofNames) {
    errors.push(`missing service refusal class proofNames ${resourceClass}`);
  }
}

function appendUnknownServiceRefusalProofErrors(
  errors,
  resourceClass,
  proofNames,
  knownProofNames,
) {
  for (const name of proofNames ?? []) {
    if (!knownProofNames.includes(name)) {
      errors.push(`unknown service refusal class proof ${resourceClass}:${name}`);
    }
  }
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
    ...serviceProductPathErrors(row, proofNames),
    ...serviceGenericPrimaryClaimErrors(row, proofNames),
    ...phpLiveCaptureBlockerErrors(row, proofNames),
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

function serviceProductPathErrors(row, proofNames) {
  const mode = row.productPathMode ?? "explicit-envelope-fallback";
  if (!allowedServiceProductPathModes.includes(mode)) {
    return [`invalid service product path mode ${row.bespokeProofName}:${mode}`];
  }
  return mode === "exact-live-marker-gated"
    ? exactLiveServiceProductPathErrors(row, proofNames)
    : [];
}

function exactLiveServiceProductPathErrors(row, proofNames) {
  return [
    serviceProductPathProofError(row, proofNames),
    serviceProductPathSupportError(row, proofNames),
    ...serviceProductPathRefusalErrors(row, proofNames),
    serviceProductPathObservedGraphError(row),
  ].filter(Boolean);
}

function serviceProductPathProofError(row, proofNames) {
  const name = row.productPathProofName;
  if (!name || !proofNames.includes(name)) {
    return `service product path ${row.bespokeProofName} missing live marker proof`;
  }
  return name.includes("-live-generic-primary-marker")
    ? undefined
    : `service product path ${row.bespokeProofName} proof is not a live marker ${name}`;
}

function serviceProductPathSupportError(row, proofNames) {
  const name = row.productPathSupportProofName;
  return name?.startsWith("generic-service-") && proofNames.includes(name)
    ? undefined
    : `service product path ${row.bespokeProofName} missing descriptor support proof`;
}

function serviceProductPathRefusalErrors(row, proofNames) {
  return unknownProofErrors({
    names: row.productPathRefusalProofNames,
    proofNames,
    missing: `service product path ${row.bespokeProofName} missing refusal proofs`,
    unknown: (name) => `service product path ${row.bespokeProofName} unknown refusal proof ${name}`,
  });
}

function serviceProductPathObservedGraphError(row) {
  return row.productPathObservedGraph === "exact-single-process-service"
    ? undefined
    : `service product path ${row.bespokeProofName} missing exact observed graph`;
}

function serviceGenericPrimaryClaimErrors(row, proofNames) {
  return row.migrationMode === "generic-primary"
    ? [
        genericPrimarySupportError(row, proofNames),
        ...genericPrimaryRefusalErrors(row, proofNames),
        ...genericPrimaryDriftRefusalErrors(row, proofNames),
      ].filter(Boolean)
    : [];
}

function genericPrimarySupportError(row, proofNames) {
  return row.genericPrimarySupportProofName &&
    proofNames.includes(row.genericPrimarySupportProofName)
    ? undefined
    : `generic-primary service ${row.bespokeProofName} missing known support proof`;
}

function genericPrimaryRefusalErrors(row, proofNames) {
  return unknownProofErrors({
    names: row.equivalentGenericRefusalProofNames,
    proofNames,
    missing: `generic-primary service ${row.bespokeProofName} missing equivalent refusal proofs`,
    unknown: (name) =>
      `generic-primary service ${row.bespokeProofName} unknown refusal proof ${name}`,
  });
}

function genericPrimaryDriftRefusalErrors(row, proofNames) {
  return unknownProofErrors({
    names: row.genericPrimaryDriftRefusalProofNames,
    proofNames,
    missing: `generic-primary service ${row.bespokeProofName} missing config/root drift refusal proofs`,
    unknown: (name) =>
      `generic-primary service ${row.bespokeProofName} unknown config/root drift refusal proof ${name}`,
  });
}

function unknownProofErrors({ names, proofNames, missing, unknown }) {
  if (!Array.isArray(names) || names.length === 0) {
    return [missing];
  }
  return names.filter((name) => !proofNames.includes(name)).map(unknown);
}

function phpLiveCaptureBlockerErrors(row, proofNames) {
  if (row.bespokeProofName !== "php-static") {
    return [];
  }
  return [
    ...unknownPhpLiveBlockerProofErrors(row, proofNames),
    phpLiveGenericPrimaryBlockedError(row),
  ].filter(Boolean);
}

function unknownPhpLiveBlockerProofErrors(row, proofNames) {
  return (row.liveCaptureBlockerProofNames ?? [])
    .filter((name) => !proofNames.includes(name))
    .map((name) => `php live-capture blocker proof unknown ${name}`);
}

function phpLiveGenericPrimaryBlockedError(row) {
  const blockers = row.liveCaptureBlockerProofNames ?? [];
  const claimsGenericPrimary = row.liveCaptureMigrationMode === "generic-primary";
  return claimsGenericPrimary && blockers.length > 0
    ? `php live-capture generic-primary blocked by live blocker proofs ${blockers.join(",")}`
    : undefined;
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
  if (!Array.isArray(row.resourceClasses) || row.resourceClasses.length === 0) {
    return `missing service resourceClasses ${row.bespokeProofName}`;
  }
  const unknown = row.resourceClasses.filter((name) => !inventory.resourceClasses?.[name]);
  return unknown.length > 0
    ? `unknown service resourceClasses ${row.bespokeProofName}:${unknown.join(",")}`
    : undefined;
}

function serviceProofError(name, proofNames, kind) {
  return name && proofNames.includes(name)
    ? undefined
    : `unknown service ${kind} proof ${name ?? "missing"}`;
}

function validateWave1Candidates(candidates, rows, proofNames) {
  return validateWaveCandidates(
    candidates,
    rows,
    proofNames,
    requiredWave1Candidates,
    "wave1",
    validateWave1Candidate,
  );
}

function validateWave2Candidates(candidates, rows, proofNames) {
  return validateWaveCandidates(
    candidates,
    rows,
    proofNames,
    requiredWave2Candidates,
    "wave2",
    validateWave2Candidate,
  );
}

function validateWaveCandidates(candidates, rows, proofNames, requiredNames, label, validateRow) {
  const candidateNames = new Set(candidates.map((row) => row.bespokeProofName).filter(Boolean));
  const rowByBespokeName = new Map(rows.map((row) => [row.bespokeProofName, row]));
  return [
    ...missingWaveCandidates(requiredNames, candidateNames, label),
    ...candidates.flatMap((row) => validateRow(row, rowByBespokeName, proofNames)),
  ];
}

function missingWaveCandidates(requiredNames, candidateNames, label) {
  return requiredNames
    .filter((name) => !candidateNames.has(name))
    .map((name) => `missing ${label} candidate ${name}`);
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

function validateDocumentationBoundary(docs) {
  const combined = Object.entries(docs)
    .map(([name, content]) => `\n--- ${name} ---\n${content}`)
    .join("\n")
    .toLowerCase();
  const requiredPhrases =
    "exact target-native resource graph support only|no arbitrary process restore|no broad daemon/database migration|no active session migration|no source-fd teleportation|no source-isa emulation|no metadata-only success|generic-cross-arch-semantic-refusals|generic-same-arch-continuation-refusals".split(
      "|",
    );
  return [
    ...requiredPhrases
      .filter((phrase) => !combined.includes(phrase))
      .map((phrase) => `documentation boundary missing phrase: ${phrase}`),
    ...requiredFullExpansionProofNames()
      .filter((name) => !combined.includes(name))
      .map((name) => `documentation boundary missing proof name: ${name}`),
  ];
}

function validateInventoryResourceClasses(inventory, proofNames) {
  const definitions = inventory.resourceClasses ?? {};
  const familyResourceClasses = inventory.families.flatMap(
    (family) => family.resourceClasses ?? [],
  );
  const familyProofNames = inventory.families.flatMap((family) => family.proofNames ?? []);
  const genericFamily = inventory.families.find(
    (family) => family.name === "first generic resource graph continuation",
  );
  return [
    ...missingResourceClassDefinitions(familyResourceClasses, definitions),
    ...incompleteResourceClassDefinitions(definitions),
    ...requiredFullExpansionProofErrors(genericFamily, proofNames, familyProofNames),
    ...requiredFullExpansionResourceClassErrors(genericFamily, definitions),
  ];
}

function inventoryResourceClassSummary(inventory) {
  const familyResourceClasses = inventory.families.flatMap(
    (family) => family.resourceClasses ?? [],
  );
  const genericFamily = inventory.families.find(
    (family) => family.name === "first generic resource graph continuation",
  );
  return {
    definitions: Object.keys(inventory.resourceClasses ?? {}).length,
    referencedByFamilies: new Set(familyResourceClasses).size,
    genericFamilyResourceClasses: new Set(genericFamily?.resourceClasses ?? []).size,
  };
}

function missingResourceClassDefinitions(resourceClasses, definitions) {
  return [...new Set(resourceClasses)]
    .filter((name) => !definitions[name])
    .map((name) => `missing resourceClass definition ${name}`);
}

function incompleteResourceClassDefinitions(definitions) {
  return Object.entries(definitions).flatMap(([name, description]) =>
    preciseResourceClassLanguageErrors(name, description),
  );
}

function preciseResourceClassLanguageErrors(name, description) {
  const errors = [];
  if (typeof description !== "string" || description.trim().length < 24) {
    errors.push(`resourceClass ${name} has imprecise short language`);
  }
  if (!resourceClassBoundaryLanguage(description)) {
    errors.push(`resourceClass ${name} missing support/refusal boundary language`);
  }
  return errors;
}

function resourceClassBoundaryLanguage(description) {
  return /refus|support|proof|target|exact|evidence|identity|policy|not |no |until|without|required|modeled/i.test(
    description,
  );
}

function requiredFullExpansionProofNames() {
  return [
    "generic-two-process-pipe-reexec",
    "generic-finite-pipe-buffer-replay",
    "generic-pipe-stdio-refusals",
    "generic-stdio-pipe-product-marker",
    "generic-multi-process-pipe-refusals",
    "generic-process-tree-refusals",
    "generic-service-process-tree-prefork",
    "generic-service-process-tree-refusals",
    "generic-unix-pathname-client-pair",
    "generic-unix-socket-wave2-refusals",
    "generic-timerfd-relative-oneshot",
    "generic-timerfd-relative-oneshot-refusals",
    "generic-signalfd-signal-state-refusals",
    "generic-file-lock-advisory",
    "generic-file-lock-refusals",
    "generic-inotify-file-follow",
    "generic-inotify-fanotify-refusals",
    "generic-mmap-file-backed-clean",
    "generic-mmap-dirty-refusals",
    "generic-epoll-timerfd-watch",
    "generic-epoll-eventfd-watch-refusals",
    "generic-service-redis-idle-parity",
    "generic-database-data-dir-refusals",
    "generic-same-arch-modeled-continuation",
    "generic-same-arch-continuation-refusals",
    "generic-cross-arch-semantic-reconstruction",
    "generic-cross-arch-semantic-refusals",
    "redis-live-generic-primary-marker",
  ];
}

function requiredFullExpansionResourceClasses() {
  return [
    "processGraph",
    "pipeGraph",
    "stdio",
    "dynamicWorkerPool",
    "activeRequestSession",
    "serviceReloadRace",
    "nonExactProcessTree",
    "unixSocketPathnameClientPair",
    "unixSocketFdPassing",
    "unixSocketCredentialSensitive",
    "unixSocketPathOccupied",
    "unixSocketPathMissingParent",
    "unixSocketPathIdentityChanged",
    "timerfdRelativeOneShot",
    "timerfdBaseline",
    "signalMaskDispositionEvidence",
    "signalfdBaseline",
    "pendingSignalState",
    "processGroupSignalAmbiguity",
    "runtimeManagedSignalTimer",
    "unknownSignalHandler",
    "fileLockAdvisory",
    "fileLockConflict",
    "fileLockBackingChanged",
    "fileLockUnknownOwner",
    "fileLockMandatory",
    "fileLockLease",
    "fileLockNonseekable",
    "fileLockUnsupportedType",
    "fileLockCrossProcessOwner",
    "inotifyFileFollow",
    "inotifyQueuedEvents",
    "inotifyDroppedEvents",
    "inotifyDirectoryMutationRace",
    "inotifyRecursiveWatch",
    "inotifyWatchIdentityChanged",
    "fanotifyPermissionEvent",
    "inotifyUnsupportedMask",
    "mmapFileBackedClean",
    "mmapDirtyShared",
    "mmapDirtyPrivate",
    "mmapAnonymousDirty",
    "mmapWritableExecutable",
    "mmapTruncationRace",
    "mmapBackingChanged",
    "epollTimerfdWatch",
    "databaseSafety",
    "databaseWalAmbiguity",
    "databaseActiveWriter",
    "databaseFileLock",
    "databaseNonEmptyPersistence",
    "databaseDirtyCheckpoint",
    "dataDirOwnershipModeChanged",
    "dataDirSymlinkHazard",
    "databaseServiceSpecificUnsafe",
    "sameArchNativeResume",
    "frozenThreadState",
    "registerStackMemoryEvidence",
    "fdResourceGraphCompatibility",
    "sameArchActiveSyscallRefusal",
    "sameArchMultiThreadRefusal",
    "sameArchUnsupportedMapping",
    "sameArchRuntimeHeapRefusal",
    "sameArchSignalStateRefusal",
    "sameArchFdRefusal",
    "sameArchResourceGraphGap",
    "crossArchSemanticDescriptor",
    "crossArchTargetNativeTool",
    "crossArchSemanticReconstruction",
    "crossArchMetadataOnlyRefusal",
    "crossArchSourceIsaEmulationRefusal",
    "crossArchRuntimeProfileShortcutRefusal",
    "crossArchArbitraryElfProcessRefusal",
    "crossArchUnsupportedResourceDescriptor",
    "crossArchMissingTargetNativeBinary",
    "crossArchIncompleteDependencyGraph",
  ];
}

function requiredFullExpansionProofErrors(genericFamily, proofNames, inventoryProofNames) {
  const genericFamilyProofNames = genericFamily?.proofNames ?? [];
  return requiredFullExpansionProofNames().flatMap((name) => {
    const errors = [];
    if (!proofNames.includes(name)) {
      errors.push(`required full-expansion proof missing from matrix ${name}`);
    }
    if (!inventoryProofNames.includes(name)) {
      errors.push(`required full-expansion proof missing from inventory ${name}`);
    }
    if (!genericFamilyProofNames.includes(name)) {
      errors.push(`required full-expansion proof missing from generic family ${name}`);
    }
    return errors;
  });
}

function requiredFullExpansionResourceClassErrors(genericFamily, definitions) {
  const genericFamilyResourceClasses = new Set(genericFamily?.resourceClasses ?? []);
  return requiredFullExpansionResourceClasses().flatMap((name) => {
    const errors = [];
    if (!definitions[name]) {
      errors.push(`required full-expansion resourceClass missing definition ${name}`);
    }
    if (!genericFamilyResourceClasses.has(name)) {
      errors.push(`required full-expansion resourceClass missing from generic family ${name}`);
    }
    return errors;
  });
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
