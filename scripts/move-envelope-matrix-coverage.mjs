#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    plan: { type: "string" },
    "coverage-dir": { type: "string" },
    json: { type: "boolean", default: false },
  },
});

if (!values.plan || !values["coverage-dir"]) {
  console.error(
    "usage: move-envelope-matrix-coverage --plan <plan.json> --coverage-dir <dir> [--json]",
  );
  process.exit(2);
}

const plan = JSON.parse(readFileSync(values.plan, "utf8"));
const expected = expectedProofs(plan);
const seen = new Map();
const failed = [];

for (const entry of readdirSync(values["coverage-dir"])) {
  if (!entry.endsWith(".json") || entry === "coverage.json") {
    continue;
  }
  const path = join(values["coverage-dir"], entry);
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("{");
  if (start < 0) {
    failed.push({ path, reason: "no-json-object" });
    continue;
  }
  let result;
  try {
    result = JSON.parse(text.slice(start));
  } catch (error) {
    failed.push({ path, reason: "invalid-json", detail: String(error) });
    continue;
  }
  if (result.state !== "passed") {
    failed.push({ path, reason: "matrix-state-not-passed", state: result.state });
  }
  for (const proof of result.proofs ?? []) {
    if (proof?.name && proof.state === "passed") {
      seen.set(proof.name, path);
    } else if (proof?.name) {
      failed.push({
        path,
        proof: proof.name,
        reason: "proof-state-not-passed",
        state: proof.state,
      });
    }
  }
}

const missing = expected.filter((name) => !seen.has(name));
const extra = [...seen.keys()].filter((name) => !expected.includes(name));
const summary = {
  state: missing.length === 0 && failed.length === 0 ? "passed" : "failed",
  plan: plan.name ?? values.plan,
  expectedCount: expected.length,
  coveredCount: expected.length - missing.length,
  missing,
  extra,
  failed,
  files: [...new Set(seen.values())].sort(),
};

if (values.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(
    `coverage ${summary.state}: ${summary.coveredCount}/${summary.expectedCount} expected proofs covered`,
  );
  if (missing.length) {
    console.log(`missing: ${missing.join(",")}`);
  }
  if (failed.length) {
    console.log(`failed files/proofs: ${JSON.stringify(failed)}`);
  }
}

if (summary.state !== "passed") {
  process.exit(1);
}

function expectedProofs(plan) {
  return [
    ...new Set([...array(plan.expectedProofs), ...array(plan.chunks).flatMap(chunkProofs)]),
  ].sort();
}

function chunkProofs(chunk) {
  return array(chunk.proofs);
}

function array(value) {
  return Array.isArray(value) ? value : [];
}
