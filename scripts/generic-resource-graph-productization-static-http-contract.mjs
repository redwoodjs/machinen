#!/usr/bin/env node
import { readFileSync } from "node:fs";

const contractPath =
  process.env.GENERIC_RESOURCE_GRAPH_STATIC_HTTP_CONTRACT ??
  "docs/snapshot/generic-resource-graph-productization-static-http-tree-identity-contract.json";
const routingSourcePath =
  process.env.GENERIC_RESOURCE_GRAPH_PRODUCT_ROUTING_SOURCE ??
  "packages/cli/src/move-generic-product-path.ts";

const contract = readJson(contractPath);
const selection = readJson(contract.sourceSelection);
const classification = readJson(contract.sourceClassification);
const inventory = readJson(contract.sourceInventory);
const routingSource = readFileSync(routingSourcePath, "utf8");

const errors = validateContract({ contract, selection, classification, inventory, routingSource });
const report = {
  contract: contract.name,
  selectedRows: contract.productizableRows?.length ?? 0,
  routingEffect: contract.contract?.productRoutingEffect,
  retainedCoveragePlan: contract.retainedCoveragePlan,
  validationProfile: contract.validationProfile,
  staticHttpContractErrors: errors,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exit(1);
}

function validateContract(input) {
  const errors = [];
  validateName(errors, input.contract);
  validateContractFields(errors, input.contract.contract);
  validateSelectedRows(errors, input);
  validateNonShipped(errors, input.contract, input.routingSource);
  validateGlobalNonClaims(errors, input.contract);
  return errors;
}

function validateName(errors, contract) {
  if (
    contract.name !== "generic-resource-graph-productization-static-http-tree-identity-contract"
  ) {
    errors.push("static HTTP contract name mismatch");
  }
}

function validateContractFields(errors, fields) {
  const expectedTree = fields?.requiredStaticRootIdentity ?? {};
  for (const [field, value] of [
    ["requiredProductPathKind", "exact-live-capture"],
    ["requiredObservedGraph", "exact-live-resource-graph"],
    ["productRoutingEffect", "promoted-after-static-http-tree-identity-validation"],
  ]) {
    if (fields?.[field] !== value) {
      errors.push(`static HTTP contract ${field} mismatch`);
    }
  }
  if (JSON.stringify(fields?.requiredRefusalClasses) !== "[]") {
    errors.push("static HTTP contract must require refusalClasses=[]");
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
    if (fields?.[field] !== true) {
      errors.push(`static HTTP contract missing ${field}`);
    }
  }
  if (expectedTree.resourceClass !== "directoryIdentity") {
    errors.push("static HTTP contract must require directoryIdentity tree evidence");
  }
  for (const field of ["sourceEvidence", "targetEvidence", "digestPolicy", "driftBehavior"]) {
    if (
      !String(expectedTree[field] ?? "").includes(
        field === "driftBehavior" ? "fail closed" : "digest",
      )
    ) {
      errors.push(`static HTTP contract missing tree ${field}`);
    }
  }
}

function validateSelectedRows(errors, input) {
  const expected = [
    "node-static-http-live-generic-primary-marker",
    "go-static-http-live-generic-primary-marker",
    "rust-static-http-live-generic-primary-marker",
    "busybox-httpd-live-generic-primary-marker",
  ];
  const rows = input.contract.productizableRows ?? [];
  const names = rows.map((row) => row.productProofName);
  if (!sameList(names, expected)) {
    errors.push(`static HTTP selected rows mismatch: ${names.join(",")}`);
  }
  const selectedByName = new Map(
    input.selection.selectedBucket.candidates.map((row) => [row.productProofName, row]),
  );
  const classifiedByName = new Map(
    input.classification.candidates.map((row) => [row.proofName, row]),
  );
  const inventoryByName = new Map(
    input.inventory.genericLiveProductPathCandidates.map((row) => [row.productProofName, row]),
  );
  for (const row of rows) {
    validateRow(errors, row, {
      selected: selectedByName.get(row.productProofName),
      classified: classifiedByName.get(row.productProofName),
      inventory: inventoryByName.get(row.productProofName),
      resourceClasses: input.inventory.resourceClasses,
      routingSource: input.routingSource,
    });
  }
}

function validateRow(errors, row, context) {
  const name = row.productProofName ?? "<missing>";
  if (!context.selected) {
    errors.push(`${name} missing from next selection`);
  }
  if (context.classified?.bucket !== "blocked-by-tree-identity") {
    errors.push(`${name} must be classified blocked-by-tree-identity`);
  }
  if (!promotedRoutingSourceIncludes(context.routingSource, name)) {
    errors.push(`${name} must route after tree identity validation`);
  }
  validateProductPath(errors, row, context.inventory);
  validateTreeRequirements(errors, row);
  validateEvidenceAndRegistrations(errors, row, context.resourceClasses);
}

function validateProductPath(errors, row, inventoryRow) {
  const name = row.productProofName ?? "<missing>";
  const path = row.productPath ?? {};
  if (path.kind !== "exact-live-capture" || path.observedGraph !== "exact-live-resource-graph") {
    errors.push(`${name} productPath exact-live metadata mismatch`);
  }
  if (path.markerProofName !== name) {
    errors.push(`${name} markerProofName mismatch`);
  }
  if (!sameList(path.supportProofNames, [inventoryRow?.supportProofName])) {
    errors.push(`${name} support proof does not match inventory`);
  }
  if (!sameList(path.existingUnsafeRefusalProofNames, inventoryRow?.refusalProofNames ?? [])) {
    errors.push(`${name} existing refusal proofs do not match inventory`);
  }
  if (!path.requiredTreeIdentityRefusalProofNames?.includes("static-http-tree-identity-refusals")) {
    errors.push(`${name} missing required tree identity refusal proof name`);
  }
  if (JSON.stringify(path.refusalClasses) !== "[]") {
    errors.push(`${name} productPath must require refusalClasses=[]`);
  }
}

function validateTreeRequirements(errors, row) {
  const name = row.productProofName ?? "<missing>";
  for (const phrase of [
    "source static root digest",
    "target static root digest",
    "directoryIdentity",
    "tree drift",
  ]) {
    if (!row.treeIdentityRequirements?.some((item) => item.includes(phrase))) {
      errors.push(`${name} missing tree requirement ${phrase}`);
    }
  }
}

function validateEvidenceAndRegistrations(errors, row, resourceClasses) {
  const name = row.productProofName ?? "<missing>";
  if (!row.targetEvidenceRequirements?.some((item) => item.includes("target HTTP"))) {
    errors.push(`${name} missing target HTTP evidence requirement`);
  }
  for (const doc of [
    "docs/snapshot/generic-resource-graph-move.md",
    "docs/snapshot/generic-resource-graph-frontier.md",
    "packages/runtime/API.md",
  ]) {
    if (!row.registrations?.documentation?.includes(doc)) {
      errors.push(`${name} missing docs/API registration ${doc}`);
    }
  }
  for (const resourceClass of row.registrations?.requiredInventoryResourceClasses ?? []) {
    if (!resourceClasses?.[resourceClass]) {
      errors.push(`${name} missing inventory resourceClass ${resourceClass}`);
    }
  }
  if (!Array.isArray(row.nonClaims) || row.nonClaims.length === 0) {
    errors.push(`${name} missing nonClaims`);
  }
}

function validateNonShipped(errors, contract, routingSource) {
  for (const proofName of contract.nonShippedCandidatesRemainOutOfRouting ?? []) {
    if (routingSource.includes(proofName)) {
      errors.push(`${proofName} non-selected row appears in product routing`);
    }
  }
}

function promotedRoutingSourceIncludes(routingSource, proofName) {
  const promotedSection = routingSource.match(
    /const promotedGenericProductPaths[\s\S]*?export function genericProductPathIsPromoted/,
  )?.[0];
  if (promotedSection?.includes(proofName)) {
    return true;
  }
  return (
    promotedSection?.includes("...staticHttpTreeIdentityProductPaths") === true &&
    routingSource.includes(proofName)
  );
}

function validateGlobalNonClaims(errors, contract) {
  for (const nonClaim of [
    "no arbitrary process restore",
    "no any-binary movement",
    "no broad daemon/database/service migration",
    "no active session migration",
    "no source-fd teleportation",
    "no source-ISA emulation",
    "no metadata-only success",
    "no runtime-profile shortcut",
  ]) {
    if (!contract.globalNonClaims?.includes(nonClaim)) {
      errors.push(`static HTTP contract missing non-claim ${nonClaim}`);
    }
  }
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
