#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const contractPath =
  process.env.GENERIC_RESOURCE_GRAPH_STATIC_HTTP_CONTRACT ??
  "docs/snapshot/generic-resource-graph-productization-static-http-tree-identity-contract.json";
const planPath =
  process.env.GENERIC_RESOURCE_GRAPH_STATIC_HTTP_PLAN ??
  "scripts/smoke/move-envelope-productization-static-http-tree-identity-plan.json";
const validationProfilePath =
  process.env.GENERIC_RESOURCE_GRAPH_STATIC_HTTP_VALIDATION_PROFILE ??
  "scripts/smoke/move-envelope-productization-static-http-tree-identity-validation-profile.json";
const retainedCoverageDir =
  process.env.GENERIC_RESOURCE_GRAPH_STATIC_HTTP_RETAINED_DIR ??
  "/tmp/machinen-productization-static-http-tree-identity-retained-coverage";
const routingSourcePath =
  process.env.GENERIC_RESOURCE_GRAPH_PRODUCT_ROUTING_SOURCE ??
  "packages/cli/src/move-generic-product-path.ts";
const genericLoaderSourcePath =
  process.env.GENERIC_RESOURCE_GRAPH_LOADER_SOURCE ??
  "packages/cli/src/move-generic-resource-graph.ts";
const docs = {
  move: readFileSync(
    process.env.GENERIC_RESOURCE_GRAPH_MOVE_DOC ?? "docs/snapshot/generic-resource-graph-move.md",
    "utf8",
  ),
  frontier: readFileSync(
    process.env.GENERIC_RESOURCE_GRAPH_FRONTIER_DOC ??
      "docs/snapshot/generic-resource-graph-frontier.md",
    "utf8",
  ),
  api: readFileSync(process.env.RUNTIME_API_DOC ?? "packages/runtime/API.md", "utf8"),
};

const contract = readJson(contractPath);
const plan = readJson(planPath);
const validationProfile = readJson(validationProfilePath);
const routingSource = readFileSync(routingSourcePath, "utf8");
const genericLoaderSource = readFileSync(genericLoaderSourcePath, "utf8");

const retained = retainedProofs(retainedCoverageDir);
const errors = validateStaticHttpProductization({
  contract,
  plan,
  validationProfile,
  routingSource,
  genericLoaderSource,
  docs,
  retained,
});

const report = {
  contract: contract.name,
  productizableRows: contract.productizableRows?.length ?? 0,
  expectedProofs: plan.expectedProofs?.length ?? 0,
  validationProfile: validationProfile.name,
  retainedCoverageDir,
  retainedProofs: retained.proofs.size,
  staticHttpProductizationErrors: errors,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exit(1);
}

function validateStaticHttpProductization(input) {
  const errors = [];
  validateContract(errors, input.contract);
  validatePlanAndProfile(errors, input.contract, input.plan, input.validationProfile);
  validateRouting(errors, input.contract, input.routingSource, input.genericLoaderSource);
  validateRetainedArtifacts(errors, input.contract, input.retained);
  validateDocs(errors, input.contract, input.docs);
  return errors;
}

function validateContract(errors, contract) {
  const expectedRows = [
    "node-static-http-live-generic-primary-marker",
    "go-static-http-live-generic-primary-marker",
    "rust-static-http-live-generic-primary-marker",
    "busybox-httpd-live-generic-primary-marker",
  ];
  const rows = (contract.productizableRows ?? []).map((row) => row.productProofName);
  if (!sameList(rows, expectedRows)) {
    errors.push(`static HTTP product rows mismatch: ${rows.join(",")}`);
  }
  if (
    contract.contract?.productRoutingEffect !==
    "no-product-move-continuation-routing-retained-reexec-evidence-only"
  ) {
    errors.push(
      "static HTTP routing effect must be retained reexec evidence only, not product move continuation routing",
    );
  }
  if (contract.continuationBoundary?.productMoveContinuationRouting !== "none") {
    errors.push("static HTTP contract must declare no product move continuation routing");
  }
  const identity = contract.contract?.requiredStaticRootIdentity ?? {};
  for (const phrase of [
    "directoryIdentity",
    "source static-root tree digest",
    "target static-root tree digest",
    "fail closed",
  ]) {
    if (!JSON.stringify(identity).includes(phrase)) {
      errors.push(`static HTTP contract missing identity phrase ${phrase}`);
    }
  }
}

function validatePlanAndProfile(errors, contract, plan, profile) {
  const expected = expectedProofsForContract(contract);
  if (!sameList([...plan.expectedProofs].sort(), [...expected].sort())) {
    errors.push("static HTTP retained plan expected proofs mismatch");
  }
  for (const proofName of expected) {
    if (!profile.productizedProofRows?.includes(proofName)) {
      errors.push(`static HTTP validation profile missing productized row ${proofName}`);
    }
    if (!profile.targetedProofImageCommand?.includes(proofName)) {
      errors.push(`static HTTP validation profile targeted command missing ${proofName}`);
    }
  }
  for (const required of [
    "retained-coverage",
    "static-http-contract",
    "productization-coverage",
    "generic-resource-graph-coverage",
    "focused-vitest",
    "docs-api-build",
    "format",
    "lint",
    "typecheck",
    "fallow-audit",
    "diff-whitespace",
  ]) {
    if (!profile.requiredValidation?.some((entry) => entry.name === required)) {
      errors.push(`static HTTP validation profile missing ${required}`);
    }
  }
}

function validateRouting(errors, contract, routingSource, genericLoaderSource) {
  for (const row of contract.productizableRows ?? []) {
    if (promotedRoutingSourceIncludes(routingSource, row.productProofName)) {
      errors.push(`${row.productProofName} must not appear in product move continuation routing`);
    }
  }
  for (const phrase of [
    "genericResourceGraphHasStaticHttpTreeIdentity",
    "staticRootTreeIdentity",
    "data-dir-identity-mismatch",
    "directoryIdentity",
    "read-only",
  ]) {
    if (!genericLoaderSource.includes(phrase)) {
      errors.push(`generic loader source missing static HTTP fail-closed guard ${phrase}`);
    }
  }
}

function validateRetainedArtifacts(errors, contract, retained) {
  for (const proofName of expectedProofsForContract(contract)) {
    const proof = retained.proofs.get(proofName);
    if (!proof) {
      errors.push(`${proofName} missing retained proof artifact`);
      continue;
    }
    if (proof.state !== "passed") {
      errors.push(`${proofName} retained proof is not passed`);
    }
  }
  for (const row of contract.productizableRows ?? []) {
    const proof = retained.proofs.get(row.productProofName);
    const marked = proof?.marked ?? {};
    if (marked.loaderStrategy !== "target-native-generic-resource-graph-reexec-loader") {
      errors.push(`${row.productProofName} retained marker did not use generic loader`);
    }
    const productPath = marked.genericMigration?.productPath ?? {};
    if (
      productPath.kind !== "exact-live-capture" ||
      productPath.observedGraph !== "exact-live-resource-graph"
    ) {
      errors.push(
        `${row.productProofName} retained marker missing exact-live productPath evidence`,
      );
    }
    if (!marked.staticRootTreeIdentity?.sourceIdentity?.treeDigest) {
      errors.push(`${row.productProofName} retained marker missing staticRootTreeIdentity digest`);
    }
    if (!marked.resourceClasses?.includes("directoryIdentity")) {
      errors.push(
        `${row.productProofName} retained marker missing directoryIdentity resource class`,
      );
    }
    if (!marked.health && !marked.response) {
      errors.push(`${row.productProofName} retained marker missing target HTTP evidence`);
    }
  }
  const treeRefusal = retained.proofs.get("static-http-tree-identity-refusals");
  for (const result of treeRefusal?.results ?? []) {
    if (
      result.loadAccepted !== false ||
      result.loaderState !== "refused" ||
      result.targetPid !== null
    ) {
      errors.push(`${result.marker} tree identity refusal did not fail closed`);
    }
  }
  for (const proofName of [
    "go-extra-socket-refusal",
    "node-active-refusal",
    "node-timer-refusal",
    "node-worker-refusal",
    "native-dlopen-refusal",
    "python-http-active-refusal",
  ]) {
    const proof = retained.proofs.get(proofName);
    if (proof?.loaderStarted !== false) {
      errors.push(`${proofName} retained refusal started a loader`);
    }
  }
}

function validateDocs(errors, contract, docs) {
  const requiredPhrases = [
    "Static HTTP tree identity",
    "scripts/smoke/move-envelope-productization-static-http-tree-identity-plan.json",
    "/tmp/machinen-productization-static-http-tree-identity-retained-coverage",
    "scripts/smoke/move-envelope-productization-static-http-tree-identity-validation-profile.json",
    "staticRootTreeIdentity",
    "directoryIdentity",
    "no arbitrary process restore",
    "no active session migration",
    "no source-fd teleportation",
    "no source-ISA emulation",
    "no metadata-only success",
    "no runtime-profile shortcut",
    "not product move continuation",
  ];
  for (const [docName, text] of Object.entries(docs)) {
    for (const row of contract.productizableRows ?? []) {
      for (const proofName of expectedProofsForRow(row)) {
        if (!text.includes(proofName)) {
          errors.push(`${docName} documentation missing ${proofName}`);
        }
      }
    }
  }
  for (const phrase of requiredPhrases) {
    if (
      !docs.move.includes(phrase) &&
      !docs.api.includes(phrase) &&
      !docs.frontier.includes(phrase)
    ) {
      errors.push(`static HTTP docs/API missing phrase ${phrase}`);
    }
  }
}

function retainedProofs(dir) {
  const proofs = new Map();
  const files = [];
  if (!existsSync(dir)) {
    return { proofs, files };
  }
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    const path = join(dir, entry);
    const result = readJson(path);
    files.push(path);
    if (result.state !== "passed") {
      proofs.set(`failed:${entry}`, { state: result.state });
    }
    for (const proof of result.proofs ?? []) {
      proofs.set(proof.name, proof);
    }
  }
  return { proofs, files };
}

function expectedProofsForContract(contract) {
  return [...new Set((contract.productizableRows ?? []).flatMap(expectedProofsForRow))];
}

function expectedProofsForRow(row) {
  return [
    row.productProofName,
    ...(row.productPath?.supportProofNames ?? []),
    ...(row.productPath?.existingUnsafeRefusalProofNames ?? []),
    ...(row.productPath?.requiredTreeIdentityRefusalProofNames ?? []),
  ].filter(Boolean);
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
