#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const INVENTORY = new URL(
  "../docs/snapshot/product-cross-arch-claim-inventory.json",
  import.meta.url,
);
const VALID_LEVELS = new Set([
  "proof-only-fixture",
  "implemented-product-support",
  "explicit-refusal",
  "obsolete-invalid-claim",
]);

function usage() {
  console.error(
    "usage: node scripts/product-portable-claim-matrix.mjs [--json] [--summary file] [--implemented-subset subset]",
  );
  process.exit(2);
}

// fallow-ignore-next-line complexity
function parseArgs(argv) {
  const options = { json: false, implementedSubset: "node-http-clean-root-v1" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--summary" || arg === "--implemented-subset") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        usage();
      }
      options[arg === "--summary" ? "summary" : "implementedSubset"] = value;
      index += 1;
      continue;
    }
    usage();
  }
  return options;
}

// fallow-ignore-next-line complexity
function validateInventory(inventory, implementedSubset) {
  const failures = [];
  const claims = Array.isArray(inventory.claims) ? inventory.claims : [];
  if (claims.length === 0) {
    failures.push("inventory has no claims");
  }
  const implemented = claims.filter(
    (claim) => claim.supportLevel === "implemented-product-support",
  );
  for (const claim of claims) {
    if (!VALID_LEVELS.has(claim.supportLevel)) {
      failures.push(`${claim.goal}:${claim.claim} has invalid supportLevel ${claim.supportLevel}`);
    }
    if (
      claim.supportLevel === "proof-only-fixture" &&
      implementedSubsets(implementedSubset).includes(claim.subset)
    ) {
      failures.push(`${claim.goal}:${claim.claim} marks implemented subset as proof-only`);
    }
    if (
      claim.supportLevel === "implemented-product-support" &&
      !implementedSubsets(implementedSubset).includes(claim.subset)
    ) {
      failures.push(`${claim.goal}:${claim.claim} is implemented without the Goal 49 subset gate`);
    }
  }
  const expectedImplemented = implementedSubsets(implementedSubset);
  if (implemented.length !== expectedImplemented.length) {
    failures.push(
      `expected ${expectedImplemented.length} implemented product claims, got ${implemented.length}`,
    );
  }
  for (const subset of expectedImplemented) {
    if (!implemented.some((claim) => claim.subset === subset)) {
      failures.push(`implemented subset ${subset} is missing`);
    }
  }
  return {
    kind: "machinen.product-portable-claim-matrix",
    inventory: resolve(INVENTORY.pathname),
    implementedSubset,
    totals: {
      claims: claims.length,
      proofOnly: claims.filter((claim) => claim.supportLevel === "proof-only-fixture").length,
      implementedProduct: implemented.length,
      explicitRefusal: claims.filter((claim) => claim.supportLevel === "explicit-refusal").length,
      obsoleteOrInvalid: claims.filter((claim) => claim.supportLevel === "obsolete-invalid-claim")
        .length,
    },
    passed: failures.length === 0,
    failures,
  };
}

function implementedSubsets(primarySubset) {
  return primarySubset === "node-http-clean-root-v1"
    ? ["node-http-clean-root-v1", "python-http-clean-root-v1", "go-http-clean-root-v1"]
    : [primarySubset];
}

const options = parseArgs(process.argv.slice(2));
const inventory = JSON.parse(readFileSync(INVENTORY, "utf8"));
const summary = validateInventory(inventory, options.implementedSubset);
// fallow-ignore-next-line code-duplication
if (options.summary) {
  writeFileSync(resolve(options.summary), `${JSON.stringify(summary, null, 2)}\n`);
}
if (options.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else if (summary.passed) {
  process.stdout.write(
    `product portable claim matrix passed: ${summary.totals.claims} claims, ${summary.totals.implementedProduct} implemented subsets\n`,
  );
} else {
  process.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
}
process.exit(summary.passed ? 0 : 1);
