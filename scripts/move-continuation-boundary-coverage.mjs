#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";

const ledgerPath =
  process.env.MOVE_CONTINUATION_BOUNDARY_LEDGER ??
  "docs/snapshot/move-continuation-boundary-classification.json";
const matrixPath = process.env.MOVE_ENVELOPE_MATRIX ?? "scripts/smoke/move-envelope-matrix.sh";
const inventoryPath =
  process.env.GENERIC_RESOURCE_GRAPH_INVENTORY ??
  "docs/snapshot/generic-resource-graph-inventory.json";
const routingSourcePath =
  process.env.GENERIC_RESOURCE_GRAPH_PRODUCT_ROUTING_SOURCE ??
  "packages/cli/src/move-generic-product-path.ts";
const docsToScan = [
  process.env.GENERIC_RESOURCE_GRAPH_MOVE_DOC ?? "docs/snapshot/generic-resource-graph-move.md",
  process.env.GENERIC_RESOURCE_GRAPH_FRONTIER_DOC ??
    "docs/snapshot/generic-resource-graph-frontier.md",
  process.env.SAME_ARCH_STOPPED_CONTINUATION_DOC ??
    "docs/snapshot/same-arch-stopped-continuation-primitive.md",
  process.env.SNAPSHOT_README_DOC ?? "docs/snapshot/README.md",
  process.env.RUNTIME_API_DOC ?? "packages/runtime/API.md",
];

const ledger = readJson(ledgerPath);
const expected = expectedRows();
const errors = validateLedger(ledger, expected);
const rows = Array.isArray(ledger.rows) ? ledger.rows : [];
const summary = rows.reduce((acc, row) => {
  acc[row.classification] = (acc[row.classification] ?? 0) + 1;
  return acc;
}, {});
const productRouted = rows.filter((row) => row.currentProductRouted).map((row) => row.proofName);
const productRoutedNonContinuation = rows
  .filter((row) => row.currentProductRouted && row.classification !== "continuation")
  .map((row) => row.proofName);
const report = {
  ledger: ledger.name,
  expectedRows: expected.length,
  classifiedRows: rows.length,
  classificationSummary: summary,
  productRouted,
  productRoutedNonContinuation,
  docsScanned: docsToScan,
  errors,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exit(1);
}

function validateLedger(ledger, expected) {
  const errors = [];
  if (ledger.name !== "move-continuation-boundary-classification") {
    errors.push("ledger name mismatch");
  }
  const rows = Array.isArray(ledger.rows) ? ledger.rows : [];
  const byName = new Map();
  const duplicates = new Set();
  for (const row of rows) {
    if (!row?.proofName) {
      errors.push("row missing proofName");
      continue;
    }
    if (byName.has(row.proofName)) {
      duplicates.add(row.proofName);
    }
    byName.set(row.proofName, row);
    validateRow(errors, row);
  }
  for (const duplicate of duplicates) {
    errors.push(`duplicate classification row ${duplicate}`);
  }
  const expectedSet = new Set(expected);
  for (const proofName of expected) {
    if (!byName.has(proofName)) {
      errors.push(`missing classification row ${proofName}`);
    }
  }
  for (const proofName of byName.keys()) {
    if (!expectedSet.has(proofName)) {
      errors.push(`extra classification row ${proofName}`);
    }
  }
  validateRoutingAgainstLedger(errors, rows);
  validateDocsAgainstLedger(errors, rows);
  validateRuntimeHardRule(errors);
  validateSameArchStoppedPrimitive(errors);
  return errors;
}

function validateRow(errors, row) {
  const allowed = ["continuation", "resource-reconstruction", "reexec", "refusal"];
  if (!allowed.includes(row.classification)) {
    errors.push(`${row.proofName} invalid classification ${row.classification}`);
  }
  if (typeof row.reason !== "string" || row.reason.trim().length === 0) {
    errors.push(`${row.proofName} missing reason`);
  }
  if (!Array.isArray(row.sources) || row.sources.length === 0) {
    errors.push(`${row.proofName} missing sources`);
  }
  if (typeof row.currentProductRouted !== "boolean") {
    errors.push(`${row.proofName} missing currentProductRouted boolean`);
  }
  if (typeof row.productMoveContinuationClaim !== "boolean") {
    errors.push(`${row.proofName} missing productMoveContinuationClaim boolean`);
  }
  if (typeof row.requiresRelabelFromProductMoveContinuation !== "boolean") {
    errors.push(`${row.proofName} missing requiresRelabelFromProductMoveContinuation boolean`);
  }
  if (row.classification !== "continuation" && row.productMoveContinuationClaim) {
    errors.push(`${row.proofName} non-continuation row claims product move continuation`);
  }
}

function validateRoutingAgainstLedger(errors, rows) {
  const routed = new Set(productRoutedProofNames());
  const rowsByName = new Map(rows.map((row) => [row.proofName, row]));
  for (const proofName of routed) {
    const row = rowsByName.get(proofName);
    if (!row) {
      errors.push(`${proofName} appears in product routing but is missing from ledger`);
      continue;
    }
    if (row.currentProductRouted !== true) {
      errors.push(`${proofName} appears in product routing but ledger currentProductRouted=false`);
    }
    if (row.classification !== "continuation") {
      errors.push(
        `${proofName} is ${row.classification} but appears in product move continuation routing`,
      );
    }
  }
  for (const row of rows) {
    if (row.currentProductRouted !== routed.has(row.proofName)) {
      errors.push(`${row.proofName} currentProductRouted does not match routing source`);
    }
  }
}

function validateRuntimeHardRule(errors) {
  const rendezvousSource = readFileSync("packages/cli/src/move-rendezvous.ts", "utf8");
  const nativeBundleSource = readFileSync("packages/cli/src/move-native-bundle.ts", "utf8");
  for (const phrase of [
    "moveDescriptorHasProductContinuationRoute",
    "continuation-only-refusal",
    "target-native reexec, restart, and resource reconstruction are banned",
  ]) {
    if (!rendezvousSource.includes(phrase) && !nativeBundleSource.includes(phrase)) {
      errors.push(`runtime hard rule missing phrase ${phrase}`);
    }
  }
  if (!rendezvousSource.includes("return false;")) {
    errors.push("runtime hard rule must fail closed while no product continuation route exists");
  }
}

function validateSameArchStoppedPrimitive(errors) {
  const source = readFileSync("packages/runtime/src/same-arch-stopped-continuation.ts", "utf8");
  const contract = readJson("docs/snapshot/same-arch-stopped-continuation-primitive-contract.json");
  if (contract.productStatus?.current !== "contract-only-not-promoted") {
    errors.push(
      "same-arch stopped primitive must remain contract-only until final proof promotion",
    );
  }
  for (const phrase of [
    "classifySameArchStoppedContinuationCapture",
    "materializeSameArchStoppedContinuationTarget",
    "no reexec or restart",
    "no metadata-only success",
  ]) {
    if (!source.includes(phrase) && !JSON.stringify(contract).includes(phrase)) {
      errors.push(`same-arch stopped primitive missing phrase ${phrase}`);
    }
  }
}

function validateDocsAgainstLedger(errors, rows) {
  const nonContinuationRows = rows.filter((row) => row.classification !== "continuation");
  for (const path of docsToScan) {
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");
    for (const [index, line] of lines.entries()) {
      for (const row of nonContinuationRows) {
        if (
          lineContainsProofName(line, row.proofName) &&
          positiveProductMoveContinuationClaim(line)
        ) {
          errors.push(
            `${path}:${index + 1} claims non-continuation row ${row.proofName} as product move continuation`,
          );
        }
      }
    }
  }
}

function lineContainsProofName(line, proofName) {
  return new RegExp(`(^|[^A-Za-z0-9_-])${escapeRegExp(proofName)}($|[^A-Za-z0-9_-])`).test(line);
}

function positiveProductMoveContinuationClaim(line) {
  const normalized = line.toLowerCase();
  if (/\b(no|not|outside|without|rather than|no longer|must not|isn't|is not)\b/.test(normalized)) {
    return false;
  }
  return /product move continuation|product continuation|product route|product support/.test(
    normalized,
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expectedRows() {
  return [
    ...new Set([
      ...matrixProofNames(),
      ...inventoryProofNames(),
      ...retainedPlanProofNames(),
      ...productRoutedProofNames(),
    ]),
  ].sort();
}

function matrixProofNames() {
  const lines = readFileSync(matrixPath, "utf8").split("\n");
  const names = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === "PROOF_NAMES=(") {
      inside = true;
      continue;
    }
    if (!inside) {
      continue;
    }
    if (line.trim() === ")") {
      break;
    }
    const name = line.trim();
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function inventoryProofNames() {
  const inventory = readJson(inventoryPath);
  const names = [];
  for (const family of inventory.families ?? []) {
    names.push(...array(family.proofNames));
  }
  for (const row of inventory.genericLiveProductPathCandidates ?? []) {
    names.push(row.productProofName, row.supportProofName, ...array(row.refusalProofNames));
  }
  return names.filter(Boolean);
}

function retainedPlanProofNames() {
  const names = [];
  for (const path of globSync("scripts/smoke/move-envelope-productization*-plan.json")) {
    const plan = readJson(path);
    names.push(...array(plan.expectedProofs));
    for (const chunk of plan.chunks ?? []) {
      names.push(...array(chunk.proofs));
    }
  }
  return names;
}

function productRoutedProofNames() {
  const source = readFileSync(routingSourcePath, "utf8");
  return [...source.matchAll(/markerProofName:\s*"([^"]+)"/g)].map((match) => match[1]);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
