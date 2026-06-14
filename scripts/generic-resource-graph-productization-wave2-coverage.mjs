#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const subsetPath =
  process.env.GENERIC_RESOURCE_GRAPH_WAVE2_PRODUCTIZATION_SUBSET ??
  "docs/snapshot/generic-resource-graph-productization-wave2-subset.json";
const inventoryPath =
  process.env.GENERIC_RESOURCE_GRAPH_INVENTORY ??
  "docs/snapshot/generic-resource-graph-inventory.json";
const routingSourcePath =
  process.env.GENERIC_RESOURCE_GRAPH_WAVE2_ROUTING_SOURCE ??
  "packages/cli/src/move-generic-product-path.ts";
const validationProfilePath =
  process.env.GENERIC_RESOURCE_GRAPH_WAVE2_VALIDATION_PROFILE ??
  "scripts/smoke/move-envelope-productization-wave2-validation-profile.json";
const matrixPath =
  process.env.GENERIC_RESOURCE_GRAPH_MATRIX ?? "scripts/smoke/move-envelope-matrix.sh";
const docs = {
  move: readFileSync(
    process.env.GENERIC_RESOURCE_GRAPH_WAVE2_MOVE_DOC ??
      "docs/snapshot/generic-resource-graph-move.md",
    "utf8",
  ),
  api: readFileSync(process.env.RUNTIME_API_DOC ?? "packages/runtime/API.md", "utf8"),
};
const retainedCoverageDir =
  process.env.GENERIC_RESOURCE_GRAPH_WAVE2_RETAINED_DIR ??
  "/tmp/machinen-productization-wave2-retained-coverage";

const subset = readJson(subsetPath);
const classification = readJson(subset.sourceClassification);
const inventory = readJson(inventoryPath);
const plan = readJson(subset.retainedCoveragePlan);
const validationProfile = readJson(validationProfilePath);
const routingSource = readFileSync(routingSourcePath, "utf8");
const matrixText = readFileSync(matrixPath, "utf8");

const errors = validateWave2Productization({
  subset,
  classification,
  inventory,
  plan,
  validationProfile,
  routingSource,
  matrixText,
  docs,
});

const report = {
  subset: subset.name,
  productizableRows: subset.productizableRows?.length ?? 0,
  expectedProofs: plan.expectedProofs?.length ?? 0,
  validationProfile: validationProfile.name,
  nonShippedRows: countNonShipped(subset),
  routingPromotedRows: routingPromotedRows(subset, routingSource),
  retainedCoverageDir,
  wave2ProductizationErrors: errors,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exit(1);
}

function validateWave2Productization(input) {
  const {
    subset,
    classification,
    inventory,
    plan,
    validationProfile,
    routingSource,
    matrixText,
    docs,
  } = input;
  const errors = [];
  validateContract(errors, subset.contract);
  validateRows(errors, subset, classification, inventory, plan, matrixText);
  validateValidationProfile(errors, plan, validationProfile);
  validateBoundaryExclusions(errors, validationProfile, routingSource);
  validateNonShipped(errors, subset, classification, routingSource);
  validateDocs(errors, subset, docs);
  validateRoutingGate(errors, subset, plan, routingSource);
  return errors;
}

function validateContract(errors, contract) {
  if (contract?.requiredProductPathKind !== "exact-live-capture") {
    errors.push("wave-2 contract must require exact-live-capture productPath kind");
  }
  if (contract?.requiredObservedGraph !== "exact-live-resource-graph") {
    errors.push("wave-2 contract must require exact-live-resource-graph observedGraph");
  }
  if (JSON.stringify(contract?.requiredRefusalClasses) !== "[]") {
    errors.push("wave-2 contract must require refusalClasses=[]");
  }
  for (const field of [
    "requiresExplicitSupportProofNames",
    "requiresEquivalentRefusalProofNames",
    "requiresTargetHealthOrOutputEvidence",
    "requiresInventoryRegistration",
    "requiresDocsApiRegistration",
    "requiresRetainedProofCoverage",
    "requiresFailClosedUnsafeNeighbors",
  ]) {
    if (contract?.[field] !== true) {
      errors.push(`wave-2 contract missing ${field}`);
    }
  }
  if (
    contract?.productRoutingEffect !==
    "no-routing-effect-until-wave2-implementation-validation-promotes-allowlist"
  ) {
    errors.push("wave-2 contract must explicitly have no routing effect until validation");
  }
}

function validateRows(errors, subset, classification, inventory, plan, matrixText) {
  const rows = subset.productizableRows ?? [];
  if (rows.length < 5 || rows.length > 8) {
    errors.push(`wave-2 productizable row count must be 5-8, got ${rows.length}`);
  }
  const classByName = new Map((classification.candidates ?? []).map((row) => [row.proofName, row]));
  const liveInventory = new Map(
    (inventory.genericLiveProductPathCandidates ?? []).map((row) => [row.productProofName, row]),
  );
  const expectedProofs = new Set(plan.expectedProofs ?? []);
  if (expectedProofs.size !== (plan.expectedProofs ?? []).length) {
    errors.push("wave-2 retained plan has duplicate expectedProofs");
  }
  const requiredProofs = new Set();
  for (const row of rows) {
    validateProductRow(
      errors,
      row,
      classByName.get(row.productProofName),
      liveInventory,
      inventory,
    );
    for (const proofName of productRowProofNames(row)) {
      requiredProofs.add(proofName);
      if (!expectedProofs.has(proofName)) {
        errors.push(`${proofName} missing from wave-2 retained plan`);
      }
    }
  }
  for (const proofName of expectedProofs) {
    if (!requiredProofs.has(proofName)) {
      errors.push(`${proofName} is extra in wave-2 retained plan`);
    }
    if (!matrixText.includes(proofName)) {
      errors.push(`${proofName} missing from move envelope matrix script`);
    }
  }
}

function validateProductRow(errors, row, classification, liveInventory, inventory) {
  const productName = row.productProofName ?? "<missing>";
  if (classification?.bucket !== "promote-now" || classification.proposedBatch !== true) {
    errors.push(`${productName} is not classified promote-now with proposedBatch=true`);
  }
  validateProductPath(errors, productName, row.productPath);
  validateInventory(errors, row, liveInventory.get(productName), inventory);
  validateRequirements(errors, row);
}

function validateProductPath(errors, productName, productPath) {
  if (productPath?.kind !== "exact-live-capture") {
    errors.push(`${productName} missing exact-live-capture productPath`);
  }
  if (productPath?.markerProofName !== productName) {
    errors.push(`${productName} productPath markerProofName mismatch`);
  }
  if (
    !Array.isArray(productPath?.supportProofNames) ||
    productPath.supportProofNames.length === 0
  ) {
    errors.push(`${productName} missing supportProofNames`);
  }
  if (
    !Array.isArray(productPath?.refusalProofNames) ||
    productPath.refusalProofNames.length === 0
  ) {
    errors.push(`${productName} missing refusalProofNames`);
  }
  if (productPath?.observedGraph !== "exact-live-resource-graph") {
    errors.push(`${productName} productPath observedGraph mismatch`);
  }
  if (JSON.stringify(productPath?.refusalClasses) !== "[]") {
    errors.push(`${productName} productPath must require refusalClasses=[]`);
  }
}

function validateInventory(errors, row, inventoryRow, inventory) {
  const productName = row.productProofName ?? "<missing>";
  if (!inventoryRow) {
    errors.push(`${productName} missing inventory live productPath row`);
    return;
  }
  if (!sameList(row.productPath?.supportProofNames, [inventoryRow.supportProofName])) {
    errors.push(`${productName} supportProofNames do not match inventory`);
  }
  if (!sameList(row.productPath?.refusalProofNames, inventoryRow.refusalProofNames)) {
    errors.push(`${productName} refusalProofNames do not match inventory`);
  }
  if (inventoryRow.productPathMode !== "exact-live-marker-gated") {
    errors.push(`${productName} inventory productPathMode is not exact-live-marker-gated`);
  }
  if (inventoryRow.productPathObservedGraph !== row.productPath?.observedGraph) {
    errors.push(`${productName} inventory observedGraph mismatch`);
  }
  for (const resourceClass of row.registrations?.requiredInventoryResourceClasses ?? []) {
    if (!inventory.resourceClasses?.[resourceClass]) {
      errors.push(`${productName} missing inventory resourceClass ${resourceClass}`);
    }
  }
}

function validateRequirements(errors, row) {
  const productName = row.productProofName ?? "<missing>";
  if (
    !Array.isArray(row.targetEvidenceRequirements) ||
    row.targetEvidenceRequirements.length === 0
  ) {
    errors.push(`${productName} missing targetEvidenceRequirements`);
  }
  const docs = row.registrations?.documentation ?? [];
  for (const requiredDoc of [
    "docs/snapshot/generic-resource-graph-move.md",
    "docs/snapshot/generic-resource-graph-frontier.md",
    "packages/runtime/API.md",
  ]) {
    if (!docs.includes(requiredDoc)) {
      errors.push(`${productName} missing documentation registration ${requiredDoc}`);
    }
  }
  if (
    row.registrations?.retainedPlan !== "scripts/smoke/move-envelope-productization-wave2-plan.json"
  ) {
    errors.push(`${productName} retainedPlan mismatch`);
  }
  if (!Array.isArray(row.nonClaims) || row.nonClaims.length === 0) {
    errors.push(`${productName} missing nonClaims`);
  }
}

function validateValidationProfile(errors, plan, validationProfile) {
  if (validationProfile?.name !== "generic-resource-graph-productization-wave2-validation") {
    errors.push("wave-2 validation profile name mismatch");
  }
  if (!sameList(validationProfile?.productizedProofRows, plan.expectedProofs ?? [])) {
    errors.push("wave-2 validation profile proof rows do not match retained plan");
  }
  for (const proofName of plan.expectedProofs ?? []) {
    if (!validationProfile?.targetedProofImageCommand?.includes(proofName)) {
      errors.push(`${proofName} missing from wave-2 targeted proof-image command`);
    }
  }
  if (!validationProfile?.targetedProofImageCommand?.includes("--timings --image <proof-image>")) {
    errors.push("wave-2 targeted proof-image command must require timings and proof image");
  }
  if (
    !validationProfile?.retainedCoverageCommand?.includes(
      "scripts/smoke/move-envelope-productization-wave2-plan.json",
    ) ||
    !validationProfile.retainedCoverageCommand.includes(
      "/tmp/machinen-productization-wave2-retained-coverage",
    )
  ) {
    errors.push("wave-2 retained coverage command must reference the wave-2 plan and retained dir");
  }
  const validationSteps = new Map(
    (validationProfile?.requiredValidation ?? []).map((row) => [row.name, row.command]),
  );
  const requiredValidationNames = new Set(validationSteps.keys());
  for (const name of [
    "matrix-syntax",
    "node-parse-checks",
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
    "diff-whitespace",
  ]) {
    if (!requiredValidationNames.has(name)) {
      errors.push(`wave-2 validation profile missing ${name}`);
    }
  }
  for (const [name, requiredPhrase] of [
    ["targeted-proof-image-rows", "proof-move-envelope-matrix"],
    ["targeted-proof-image-rows", "--timings --image <proof-image>"],
    ["retained-coverage", "scripts/smoke/move-envelope-productization-wave2-plan.json"],
    ["retained-coverage", "/tmp/machinen-productization-wave2-retained-coverage"],
    ["productization-coverage", "pnpm run generic-resource-graph-productization-coverage"],
    ["generic-resource-graph-coverage", "pnpm run generic-resource-graph-coverage"],
    ["proof-image-boundary", "pnpm run check-move-proof-image-boundary"],
    ["smoke-manifest", "pnpm run check-smoke-manifest"],
    ["docs-api-build", "pnpm run build:docs"],
    ["format", "pnpm run format:check"],
    ["lint", "pnpm run lint"],
    ["typecheck", "pnpm run typecheck"],
    ["focused-vitest", "npx vitest run"],
    ["fallow-audit", "pnpm exec fallow audit --changed-since origin/main"],
    ["diff-whitespace", "git diff --check"],
  ]) {
    if (!String(validationSteps.get(name) ?? "").includes(requiredPhrase)) {
      errors.push(`wave-2 validation profile ${name} command missing ${requiredPhrase}`);
    }
  }
  if (validationProfile?.fullAllProofsMatrix?.defaultScope !== "manual-nightly-release-only") {
    errors.push(
      "wave-2 validation profile must keep full all-proofs matrix manual/nightly/release",
    );
  }
  for (const condition of ["release validation", "nightly validation"]) {
    if (!validationProfile?.fullAllProofsMatrix?.runWhen?.includes(condition)) {
      errors.push(`wave-2 validation profile full all-proofs missing condition ${condition}`);
    }
  }
  if (
    validationProfile?.fullSmokeTests?.defaultScope !==
    "skip-for-docs-coverage-proof-row-productization-only"
  ) {
    errors.push("wave-2 validation profile must keep full smoke tests conditional");
  }
  for (const condition of [
    "VM lifecycle changes",
    "VMM changes",
    "rootfs/base asset changes",
    "CLI boot/exec/mount changes",
    "snapshot/restore lifecycle changes",
    "virtio device changes",
    "memory or ballooning changes",
    "FUSE/live mount changes",
    "user explicitly asks for full smoke tests",
  ]) {
    if (!validationProfile?.fullSmokeTests?.runWhen?.includes(condition)) {
      errors.push(`wave-2 validation profile full smoke missing condition ${condition}`);
    }
  }
  for (const nonClaim of [
    "No arbitrary process restore",
    "No any-binary movement",
    "No broad daemon/database/service migration",
    "No active session migration",
    "No source-fd teleportation",
    "No source-ISA emulation",
    "No metadata-only success",
    "No runtime-profile shortcut",
    "No proof-image runtime dependency",
  ]) {
    if (!validationProfile?.nonClaims?.includes(nonClaim)) {
      errors.push(`wave-2 validation profile missing non-claim ${nonClaim}`);
    }
  }
}

function validateBoundaryExclusions(errors, validationProfile, routingSource) {
  for (const proofName of excludedProductRoutingProofNames()) {
    if (staticHttpTreeIdentityRows().includes(proofName)) {
      continue;
    }
    if (productRoutingSourceIncludes(routingSource, proofName)) {
      errors.push(`${proofName} must remain outside product routing`);
    }
    if (validationProfile?.productizedProofRows?.includes(proofName)) {
      errors.push(`${proofName} must remain outside wave-2 productized proof rows`);
    }
  }
  for (const term of ["move-proof-image", "proof-image", "MACHINEN_MOVE_MATRIX_IMAGE"]) {
    if (routingSource.includes(term)) {
      errors.push(`proof image term ${term} must remain outside product routing`);
    }
  }
}

function validateNonShipped(errors, subset, classification, routingSource) {
  const nonShipped = Object.values(subset.nonShippedCandidates ?? {}).flat();
  if (nonShipped.length !== 15) {
    errors.push(`wave-2 non-shipped candidate count must be 15, got ${nonShipped.length}`);
  }
  const productized = new Set((subset.productizableRows ?? []).map((row) => row.productProofName));
  const classByName = new Map((classification.candidates ?? []).map((row) => [row.proofName, row]));
  for (const proofName of nonShipped) {
    if (productized.has(proofName)) {
      errors.push(`${proofName} cannot be both productizable and non-shipped`);
    }
    const bucket = classByName.get(proofName)?.bucket;
    if (bucket === "promote-now") {
      errors.push(`${proofName} non-shipped candidate is still classified promote-now`);
    }
    if (
      productRoutingSourceIncludes(routingSource, proofName) &&
      !staticHttpTreeIdentityRows().includes(proofName)
    ) {
      errors.push(`${proofName} is non-shipped but appears in product routing source`);
    }
  }
}

function validateDocs(errors, subset, docs) {
  for (const row of subset.productizableRows ?? []) {
    for (const proofName of productRowProofNames(row)) {
      if (!docs.move.includes(proofName)) {
        errors.push(`move documentation missing ${proofName}`);
      }
    }
    if (!normalizeText(docs.api).includes(row.productProofName)) {
      errors.push(`runtime API documentation missing ${row.productProofName}`);
    }
  }
  for (const phrase of [
    "scripts/smoke/move-envelope-productization-wave2-validation-profile.json",
    "/tmp/machinen-productization-wave2-retained-coverage",
    "scripts/smoke/move-envelope-productization-wave2-plan.json",
    "no arbitrary process restore",
    "no active session migration",
    "no source-fd teleportation",
    "no source-ISA emulation",
    "no metadata-only success",
  ]) {
    if (!docs.move.includes(phrase) && !normalizeText(docs.api).includes(phrase)) {
      errors.push(`wave-2 docs/API missing non-claim phrase ${phrase}`);
    }
  }
}

function validateRoutingGate(errors, subset, plan, routingSource) {
  const routed = routingPromotedRows(subset, routingSource);
  if (routed.length === 0) {
    return;
  }
  for (const proofName of plan.expectedProofs ?? []) {
    const artifact = join(retainedCoverageDir, `${proofName}.json`);
    if (!existsSync(artifact)) {
      errors.push(`${proofName} missing wave-2 retained artifact while routing is promoted`);
      continue;
    }
    const retained = readJson(artifact);
    const proof = retained.proofs?.find((candidate) => candidate.name === proofName);
    if (retained.state !== "passed" || proof?.state !== "passed") {
      errors.push(`${proofName} wave-2 retained artifact is not passed while routing is promoted`);
    }
  }
}

function productRowProofNames(row) {
  return [
    row.productProofName,
    ...(row.productPath?.supportProofNames ?? []),
    ...(row.productPath?.refusalProofNames ?? []),
  ].filter(Boolean);
}

function staticHttpTreeIdentityRows() {
  return [
    "node-static-http-live-generic-primary-marker",
    "go-static-http-live-generic-primary-marker",
    "rust-static-http-live-generic-primary-marker",
    "busybox-httpd-live-generic-primary-marker",
  ];
}

function excludedProductRoutingProofNames() {
  return [
    "generic-service-process-tree-prefork",
    "generic-same-arch-modeled-continuation",
    "generic-cross-arch-semantic-reconstruction",
    "generic-service-nginx-static-parity",
    "generic-service-caddy-static-parity",
    "generic-service-ruby-http-parity",
    "generic-service-rsync-daemon-parity",
    "generic-service-redis-idle-parity",
    "generic-service-php-static-parity",
    "generic-database-data-dir-refusals",
    "node-static-http-live-generic-primary-marker",
    "go-static-http-live-generic-primary-marker",
    "rust-static-http-live-generic-primary-marker",
    "busybox-httpd-live-generic-primary-marker",
    "nginx-live-generic-primary-marker",
    "caddy-live-generic-primary-marker",
    "ruby-live-generic-primary-marker",
    "rsync-live-generic-primary-marker",
    "redis-live-generic-primary-marker",
    "tail-live-generic-primary-marker",
  ];
}

function routingPromotedRows(subset, routingSource) {
  return (subset.productizableRows ?? [])
    .map((row) => row.productProofName)
    .filter((proofName) => productRoutingSourceIncludes(routingSource, proofName));
}

function productRoutingSourceIncludes(routingSource, proofName) {
  const promotedSection = routingSource.match(
    /const promotedGenericProductPaths[\s\S]*?export function genericProductPathIsPromoted/,
  )?.[0];
  return promotedSection?.includes(proofName) ?? routingSource.includes(proofName);
}

function countNonShipped(subset) {
  return Object.values(subset.nonShippedCandidates ?? {}).flat().length;
}

function sameList(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function normalizeText(text) {
  return text.replaceAll(/\s+/g, " ");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}
