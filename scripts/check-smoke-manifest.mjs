#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("scripts/smoke/manifest.json", "utf8"));
const errors = [];
const allowedClassifications = new Set(["product-smoke", "helper"]);
const forbiddenPackageScriptPath =
  /scripts\/(?:advanced-linux|architecture-portable|controlled-binary|continuation|dwarf-symbol|go-quiescent|goal40|guest-checkpoint|hard-runtime|known-symbol|native-|nested-virtualization|node-|non-node|opposite-isa|portable-machine|postgres|proof-|raw-process|real-target|runtime-adapter|runtime-confidence|runtime-state|runtime-support|sidecar|stateful-)/u;

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(path);
    }
    return entry.isFile() && entry.name.endsWith(".sh") ? [path] : [];
  });
}

const expectedFiles = new Set([
  "scripts/smoke-tests.sh",
  "scripts/smoke-test-snapshot-restore-fork.sh",
  ...walk("scripts/smoke"),
]);
const manifestFiles = new Set(manifest.entries.map((entry) => entry.path));

for (const file of expectedFiles) {
  if (!manifestFiles.has(file)) {
    errors.push(`missing manifest entry for ${file}`);
  }
}
for (const file of manifestFiles) {
  if (!expectedFiles.has(file)) {
    errors.push(`manifest entry references missing file ${file}`);
  }
}

const entriesByPackageScript = new Map();
for (const entry of manifest.entries) {
  if (!allowedClassifications.has(entry.classification)) {
    errors.push(`unsupported smoke classification ${entry.classification} for ${entry.path}`);
  }
  for (const packageScript of entry.packageScripts ?? []) {
    if (entriesByPackageScript.has(packageScript)) {
      errors.push(`duplicate packageScripts entry ${packageScript}`);
    }
    entriesByPackageScript.set(packageScript, entry);
  }
}

for (const [name, command] of Object.entries(pkg.scripts)) {
  if (name.startsWith("proof-") || name.startsWith("archive-")) {
    errors.push(`proof/archive package script ${name} is not allowed`);
  }
  if (command.includes("scripts/archived-smoke.mjs")) {
    errors.push(`package script ${name} routes to archived-smoke`);
  }
  if (forbiddenPackageScriptPath.test(command)) {
    errors.push(`package script ${name} routes to a proof/research script`);
  }
  if (name.startsWith("smoke-") || name === "smoke-tests") {
    const entry = entriesByPackageScript.get(name);
    if (!entry) {
      errors.push(`active smoke package script ${name} missing from manifest`);
    }
    if (entry && entry.classification !== "product-smoke") {
      errors.push(
        `active smoke package script ${name} is ${entry.classification}, not product-smoke`,
      );
    }
  }
}

for (const entry of manifest.entries) {
  for (const packageScript of entry.packageScripts ?? []) {
    if (!pkg.scripts[packageScript]) {
      errors.push(`manifest references missing package script ${packageScript}`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `smoke manifest: ${error}`).join("\n"));
  process.exit(1);
}

console.log(`smoke manifest ok: ${manifest.entries.length} entries`);
