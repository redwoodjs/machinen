#!/usr/bin/env node
import { readFileSync } from "node:fs";

const selectionPath =
  process.env.GENERIC_RESOURCE_GRAPH_NEXT_SELECTION ??
  "docs/snapshot/generic-resource-graph-productization-next-selection.json";
const routingSourcePath =
  process.env.GENERIC_RESOURCE_GRAPH_PRODUCT_ROUTING_SOURCE ??
  "packages/cli/src/move-generic-product-path.ts";

const selection = readJson(selectionPath);
const classification = readJson(selection.sourceClassification);
const subset = readJson(selection.sourceSubset);
const routingSource = readFileSync(routingSourcePath, "utf8");

const errors = validateNextSelection({ selection, classification, subset, routingSource });
const report = {
  selection: selection.name,
  selectedBucket: selection.selectedBucket?.bucket,
  selectedCount: selection.selectedBucket?.candidates?.length ?? 0,
  deferredAlternativeBuckets: (selection.deferredAlternatives ?? []).map((bucket) => bucket.bucket),
  routingEffect: selection.routingEffect,
  nextSelectionErrors: errors,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exit(1);
}

function validateNextSelection({ selection, classification, subset, routingSource }) {
  const errors = [];
  if (selection.name !== "generic-resource-graph-productization-next-selection") {
    errors.push("next selection name mismatch");
  }
  if (selection.selectedBucket?.bucket !== "blocked-by-tree-identity") {
    errors.push("next selection must choose blocked-by-tree-identity");
  }
  const selected = selection.selectedBucket?.candidates ?? [];
  const expected = [
    "node-static-http-live-generic-primary-marker",
    "go-static-http-live-generic-primary-marker",
    "rust-static-http-live-generic-primary-marker",
    "busybox-httpd-live-generic-primary-marker",
  ];
  const selectedNames = selected.map((row) => row.productProofName);
  if (!sameList(selectedNames, expected)) {
    errors.push(`selected static HTTP rows mismatch: ${selectedNames.join(",")}`);
  }
  const classByName = new Map((classification.candidates ?? []).map((row) => [row.proofName, row]));
  const wave2Shipped = new Set((subset.productizableRows ?? []).map((row) => row.productProofName));
  for (const row of selected) {
    const name = row.productProofName;
    const classificationRow = classByName.get(name);
    if (classificationRow?.bucket !== "blocked-by-tree-identity") {
      errors.push(`${name} must still be classified blocked-by-tree-identity`);
    }
    if (classificationRow?.proposedBatch === true) {
      errors.push(`${name} must not be in the wave-2 proposed batch`);
    }
    if (wave2Shipped.has(name)) {
      errors.push(`${name} must not already be wave-2 shipped`);
    }
    if (routingSource.includes(name)) {
      errors.push(`${name} must not appear in product routing before tree identity is proven`);
    }
    if (!Array.isArray(row.missingBeforePromotion) || row.missingBeforePromotion.length < 5) {
      errors.push(`${name} missingBeforePromotion is incomplete`);
    }
    for (const phrase of [
      "source static-root tree digest evidence",
      "target static-root tree digest evidence",
      "tree drift refusal row",
      "docs/API support matrix entry",
      "retained artifacts",
    ]) {
      if (!row.missingBeforePromotion.some((item) => item.includes(phrase))) {
        errors.push(`${name} missing promotion requirement ${phrase}`);
      }
    }
    if (!Array.isArray(row.nonClaims) || row.nonClaims.length === 0) {
      errors.push(`${name} missing nonClaims`);
    }
  }
  const alternatives = new Set((selection.deferredAlternatives ?? []).map((row) => row.bucket));
  for (const bucket of [
    "promote-after-missing-refusal",
    "blocked-by-service-safety",
    "blocked-by-session-state",
  ]) {
    if (!alternatives.has(bucket)) {
      errors.push(`missing deferred alternative bucket ${bucket}`);
    }
  }
  if (!String(selection.routingEffect ?? "").includes("none")) {
    errors.push("next selection must have no routing effect");
  }
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
    if (!selection.globalNonClaims?.includes(nonClaim)) {
      errors.push(`next selection missing non-claim ${nonClaim}`);
    }
  }
  return errors;
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
