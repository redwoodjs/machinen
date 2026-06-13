#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const forbiddenRuntimeTerms = [
  "MACHINEN_MOVE_MATRIX_IMAGE",
  "move-proof-image",
  "proof-image",
  "build-move-proof-image",
];
const runtimeRoots = [
  "packages/cli/src",
  "packages/runtime/src",
  "packages/native-arm64-linux",
  "packages/native-x64-linux",
  "scripts/build-base-assets.sh",
  "scripts/check-asset-freshness.sh",
];
const errors = [];

for (const file of runtimeFiles(runtimeRoots)) {
  const text = readFileSync(file, "utf8");
  for (const term of forbiddenRuntimeTerms) {
    if (text.includes(term)) {
      errors.push(`proof image term ${term} found in runtime/product path ${file}`);
    }
  }
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const scripts = packageJson.scripts ?? {};
if (scripts["move-envelope:build-proof-image"] !== "node scripts/build-move-proof-image.mjs") {
  errors.push("proof image builder must remain an explicit move-envelope validation script");
}
for (const [name, command] of Object.entries(scripts)) {
  if (
    name !== "move-envelope:build-proof-image" &&
    String(command).includes("build-move-proof-image")
  ) {
    errors.push(`proof image builder referenced by product/default script ${name}`);
  }
}

const matrix = readFileSync("scripts/smoke/move-envelope-matrix.sh", "utf8");
for (const phrase of ["MACHINEN_MOVE_MATRIX_IMAGE", "--image", 'PROVISION_MODE="proof-image:']) {
  if (!matrix.includes(phrase)) {
    errors.push(`move matrix missing proof-image validation phrase ${phrase}`);
  }
}

const docs = readFileSync(
  process.env.MOVE_ENVELOPE_FRAMEWORK_DOC ?? "docs/snapshot/move-envelope-framework.md",
  "utf8",
);
for (const phrase of [
  "validation fixture only",
  "not a product base asset",
  "not copied into `packages/native-*`",
  "not selected by runtime defaults",
  "not a dependency for runtime users",
  "manual, nightly, or release-scope validation",
]) {
  if (!docs.includes(phrase)) {
    errors.push(`proof image docs missing phrase ${phrase}`);
  }
}

const report = {
  checkedRuntimeFiles: runtimeFiles(runtimeRoots).length,
  checkedScripts: Object.keys(scripts).length,
  proofImageBoundaryErrors: errors,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exit(1);
}

function runtimeFiles(paths) {
  return paths.flatMap((path) => collectRuntimeFiles(path));
}

function collectRuntimeFiles(path) {
  const stat = statSync(path);
  if (stat.isFile()) {
    return includeRuntimeFile(path) ? [path] : [];
  }
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (entry === "__tests__" || entry === "dist" || entry === "node_modules") {
      return [];
    }
    return collectRuntimeFiles(child);
  });
}

function includeRuntimeFile(path) {
  return /\.(ts|mjs|js|json|sh)$/.test(path) && !path.includes("/__tests__/");
}
