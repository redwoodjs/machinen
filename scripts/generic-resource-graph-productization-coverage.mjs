#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const subsetPath =
  process.env.GENERIC_RESOURCE_GRAPH_PRODUCTIZATION_SUBSET ??
  "docs/snapshot/generic-resource-graph-productization-subset.json";
const inventoryPath =
  process.env.GENERIC_RESOURCE_GRAPH_INVENTORY ??
  "docs/snapshot/generic-resource-graph-inventory.json";
const validationProfilePath =
  process.env.GENERIC_RESOURCE_GRAPH_PRODUCTIZATION_VALIDATION_PROFILE ??
  "scripts/smoke/move-envelope-productization-phase1-validation-profile.json";
const blockersPath =
  process.env.GENERIC_RESOURCE_GRAPH_PRODUCTIZATION_BLOCKERS ??
  "docs/snapshot/generic-resource-graph-productization-blockers.json";
const retainedCoverageDir =
  process.env.GENERIC_RESOURCE_GRAPH_PRODUCTIZATION_COVERAGE_DIR ??
  "/tmp/machinen-productization-phase1-retained-coverage";
const docs = {
  frontier: readFileSync(
    process.env.GENERIC_RESOURCE_GRAPH_FRONTIER_DOC ??
      "docs/snapshot/generic-resource-graph-frontier.md",
    "utf8",
  ),
  move: readFileSync(
    process.env.GENERIC_RESOURCE_GRAPH_MOVE_DOC ?? "docs/snapshot/generic-resource-graph-move.md",
    "utf8",
  ),
  pipes: readFileSync(
    process.env.GENERIC_PIPES_STDIO_DOC ?? "docs/snapshot/generic-pipes-stdio-graduation.md",
    "utf8",
  ),
  api: readFileSync(process.env.RUNTIME_API_DOC ?? "packages/runtime/API.md", "utf8"),
};

const subset = readJson(subsetPath);
const classification = readJson(subset.sourceClassification);
const inventory = readJson(inventoryPath);
const plan = readJson(subset.retainedCoveragePlan);
const validationProfile = readJson(validationProfilePath);
const blockers = readJson(blockersPath);
const errors = validateProductizationSubset(subset, classification, inventory, plan, docs);
errors.push(...validateValidationProfile(validationProfile, plan));
errors.push(...validateKnownBlockers(blockers, docs));
const report = {
  subset: subset.name,
  productizableRows: subset.productizableRows?.length ?? 0,
  expectedProofs: plan.expectedProofs?.length ?? 0,
  retainedCoverageDir,
  validationProfile: validationProfile.name,
  blockerRows: blockers.blockers?.length ?? 0,
  productizationErrors: errors,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exit(1);
}

function validateProductizationSubset(subset, classification, inventory, plan, docs) {
  const errors = [];
  requireContract(errors, subset.contract);
  const classByName = new Map((classification.rows ?? []).map((row) => [row.proofName, row]));
  const inventoryByProduct = new Map(
    (inventory.genericLiveProductPathCandidates ?? []).map((row) => [row.productProofName, row]),
  );
  for (const row of subset.productizableRows ?? []) {
    validateProductRow(errors, row, classByName, inventoryByProduct, inventory, plan, docs);
  }
  validateDocumentationNonClaims(errors, docs);
  if (!Array.isArray(subset.productizableRows) || subset.productizableRows.length === 0) {
    errors.push("productization subset has no productizable rows");
  }
  return errors;
}

function requireContract(errors, contract) {
  if (contract?.requiredProductPathKind !== "exact-live-capture") {
    errors.push("productization contract must require exact-live-capture productPath kind");
  }
  if (JSON.stringify(contract?.requiredRefusalClasses) !== "[]") {
    errors.push("productization contract must require refusalClasses=[]");
  }
  for (const field of [
    "requiresExplicitSupportProof",
    "requiresExplicitRefusalProofs",
    "requiresTargetHealthOrOutputEvidence",
    "requiresInventoryRegistration",
    "requiresDocumentationRegistration",
    "requiresRetainedProofCoverage",
  ]) {
    if (contract?.[field] !== true) {
      errors.push(`productization contract missing ${field}`);
    }
  }
}

function validateProductRow(errors, row, classByName, inventoryByProduct, inventory, plan, docs) {
  const productName = row.productProofName ?? "<missing>";
  validateClassification(errors, productName, classByName.get(productName));
  validateProductPath(errors, productName, row.productPath);
  validateInventory(errors, row, inventoryByProduct.get(productName), inventory);
  validatePlanAndRetained(errors, row, plan);
  validateDocs(errors, row, docs);
}

function validateClassification(errors, productName, classification) {
  if (
    classification?.classification !== "product-candidate" ||
    classification.productPathEligible !== true
  ) {
    errors.push(`${productName} is not classified as product-candidate productPathEligible=true`);
  }
}

function validateProductPath(errors, productName, productPath) {
  if (productPath?.kind !== "exact-live-capture") {
    errors.push(`${productName} missing exact-live-capture productPath metadata`);
  }
  if (productPath?.markerProofName !== productName) {
    errors.push(`${productName} productPath markerProofName mismatch`);
  }
  if (!productPath?.supportProofName) {
    errors.push(`${productName} missing supportProofName`);
  }
  if (
    !Array.isArray(productPath?.refusalProofNames) ||
    productPath.refusalProofNames.length === 0
  ) {
    errors.push(`${productName} missing refusalProofNames`);
  }
  if (JSON.stringify(productPath?.refusalClasses) !== "[]") {
    errors.push(`${productName} productPath must require refusalClasses=[]`);
  }
}

function validateInventory(errors, row, inventoryRow, inventory) {
  const productName = row.productProofName ?? "<missing>";
  if (!inventoryRow) {
    errors.push(`${productName} missing inventory productPath row`);
    return;
  }
  if (inventoryRow.supportProofName !== row.productPath?.supportProofName) {
    errors.push(`${productName} inventory supportProofName mismatch`);
  }
  if (!sameList(inventoryRow.refusalProofNames, row.productPath?.refusalProofNames)) {
    errors.push(`${productName} inventory refusalProofNames mismatch`);
  }
  if (inventoryRow.productPathMode !== "exact-live-marker-gated") {
    errors.push(`${productName} inventory productPathMode is not exact-live-marker-gated`);
  }
  if (inventoryRow.productPathObservedGraph !== row.productPath?.observedGraph) {
    errors.push(`${productName} inventory observedGraph mismatch`);
  }
  if (!inventoryRow.boundary || !inventoryRow.nonClaim) {
    errors.push(`${productName} inventory missing boundary/nonClaim`);
  }
  for (const resourceClass of row.registrations?.requiredInventoryResourceClasses ?? []) {
    if (!inventory.resourceClasses?.[resourceClass]) {
      errors.push(`${productName} missing inventory resourceClass ${resourceClass}`);
    }
  }
}

function validatePlanAndRetained(errors, row, plan) {
  const productName = row.productProofName ?? "<missing>";
  const proofNames = [
    productName,
    row.productPath?.supportProofName,
    ...(row.productPath?.refusalProofNames ?? []),
  ];
  for (const proofName of proofNames.filter(Boolean)) {
    if (!plan.expectedProofs?.includes(proofName)) {
      errors.push(`${proofName} missing from productization retained plan`);
    }
    const artifact = join(retainedCoverageDir, `${proofName}.json`);
    if (!existsSync(artifact)) {
      errors.push(`${proofName} missing retained artifact`);
      continue;
    }
    const retained = readJson(artifact);
    const proof = retained.proofs?.find((candidate) => candidate.name === proofName);
    if (retained.state !== "passed" || proof?.state !== "passed") {
      errors.push(`${proofName} retained artifact is not passed`);
    }
    validateRetainedProof(errors, row, proofName, proof);
  }
}

function validateRetainedProof(errors, row, proofName, proof) {
  if (proofName === row.productProofName) {
    validateRetainedProductMarker(errors, row, proof);
  }
  if (proofName === row.productPath?.supportProofName && proof?.loadAccepted !== true) {
    errors.push(`${proofName} support artifact did not loadAccepted=true`);
  }
  if (row.productPath?.refusalProofNames?.includes(proofName)) {
    validateRetainedRefusals(errors, proofName, proof);
  }
}

function validateRetainedProductMarker(errors, row, proof) {
  const productName = row.productProofName;
  if (proof?.productPath?.kind !== row.productPath?.kind) {
    errors.push(`${productName} retained marker missing exact productPath kind`);
  }
  if (proof?.productPath?.supportProofName !== row.productPath?.supportProofName) {
    errors.push(`${productName} retained marker supportProofName mismatch`);
  }
  if (!sameList(proof?.productPath?.refusalProofNames, row.productPath?.refusalProofNames)) {
    errors.push(`${productName} retained marker refusalProofNames mismatch`);
  }
  if (proof?.unsafeLoadAccepted !== false || proof?.unsafeLoaderStarted !== false) {
    errors.push(`${productName} retained marker unsafe sibling did not fail closed`);
  }
  if (!row.targetEvidence?.markerTargetOutput) {
    errors.push(`${productName} missing target output evidence`);
  }
}

function validateRetainedRefusals(errors, proofName, proof) {
  if (!Array.isArray(proof?.cases) || proof.cases.length === 0) {
    errors.push(`${proofName} retained refusal artifact has no cases`);
    return;
  }
  for (const refusalCase of proof.cases) {
    if (refusalCase.targetPid !== null) {
      errors.push(`${proofName}:${refusalCase.case} refusal targetPid must be null`);
    }
  }
}

function validateDocs(errors, row, docs) {
  const proofNames = [
    row.productProofName,
    row.productPath?.supportProofName,
    ...(row.productPath?.refusalProofNames ?? []),
  ];
  for (const proofName of proofNames.filter(Boolean)) {
    for (const [docName, text] of Object.entries(docs)) {
      if (!text.includes(proofName)) {
        errors.push(`${docName} documentation missing ${proofName}`);
      }
    }
  }
}

function validateValidationProfile(profile, plan) {
  const errors = [];
  for (const proofName of plan.expectedProofs ?? []) {
    if (!profile.productizedProofRows?.includes(proofName)) {
      errors.push(`validation profile missing productized proof row ${proofName}`);
    }
    if (!profile.targetedProofImageCommand?.includes(proofName)) {
      errors.push(`validation profile targeted proof command missing ${proofName}`);
    }
  }
  for (const name of [
    "targeted-proof-image-rows",
    "retained-coverage",
    "productization-coverage",
    "generic-resource-graph-coverage",
    "proof-image-boundary",
    "smoke-manifest",
    "docs-api-build",
    "format",
    "lint",
    "typecheck",
    "focused-vitest",
    "fallow-audit",
  ]) {
    if (!profile.requiredValidation?.some((step) => step.name === name)) {
      errors.push(`validation profile missing required step ${name}`);
    }
  }
  if (profile.fullAllProofsMatrix?.defaultScope !== "manual-nightly-release-only") {
    errors.push("validation profile must keep full all-proofs matrix manual/nightly/release only");
  }
  if (!profile.fullSmokeTests?.runWhen?.includes("VM lifecycle changes")) {
    errors.push("validation profile missing full smoke VM lifecycle condition");
  }
  return errors;
}

function validateKnownBlockers(blockers, docs) {
  const errors = [];
  const required = [
    "remote-amd64-proof-host-availability",
    "php-live-capture-generic-primary-blockers",
    "node-static-full-tree-digest-identity",
    "broad-database-service-session-movement",
  ];
  const rows = new Map((blockers.blockers ?? []).map((row) => [row.id, row]));
  for (const id of required) {
    const row = rows.get(id);
    if (!row) {
      errors.push(`known blockers missing ${id}`);
      continue;
    }
    if (row.status !== "deferred") {
      errors.push(`known blocker ${id} must be explicitly deferred`);
    }
    if (!row.currentEvidence || !row.productImpact) {
      errors.push(`known blocker ${id} missing evidence or product impact`);
    }
    if (!Array.isArray(row.nonClaims) || row.nonClaims.length === 0) {
      errors.push(`known blocker ${id} missing nonClaims`);
    }
  }
  for (const phrase of [
    "remote amd64 proof host availability",
    "uname -m=aarch64",
    "PHP live-capture generic-primary blockers",
    "writable stdio/log fds",
    "deleted Zend semaphore fd",
    "unmodeled socket fd",
    "Node static full tree digest identity",
    "no Node static HTTP generic product support in phase 1",
    "broad database/service/session movement",
    "no broad daemon/database/service migration",
  ]) {
    if (!docs.move.includes(phrase)) {
      errors.push(`move documentation missing known blocker phrase ${phrase}`);
    }
  }
  return errors;
}

function validateDocumentationNonClaims(errors, docs) {
  for (const phrase of [
    "generic-stdio-pipe-product-marker",
    "generic-finite-pipe-buffer-replay",
    "generic-pipe-stdio-refusals",
    "no arbitrary process restore",
    "no broad daemon/database",
    "no active session",
    "no source-fd teleportation",
    "no source-ISA emulation",
    "no metadata-only success",
  ]) {
    if (!Object.values(docs).some((text) => text.includes(phrase))) {
      errors.push(`productization docs missing phrase ${phrase}`);
    }
  }
  for (const phrase of ["generic-stdio-pipe-product-marker", "no arbitrary process restore"]) {
    if (!normalizeText(docs.api).includes(phrase)) {
      errors.push(`runtime API documentation missing phrase ${phrase}`);
    }
  }
}

function normalizeText(text) {
  return text.replaceAll(/\s+/g, " ");
}

function sameList(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
