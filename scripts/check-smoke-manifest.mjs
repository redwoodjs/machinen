#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("scripts/smoke/manifest.json", "utf8"));
const errors = [];

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
  for (const packageScript of entry.packageScripts ?? []) {
    if (entriesByPackageScript.has(packageScript)) {
      errors.push(`duplicate packageScripts entry ${packageScript}`);
    }
    entriesByPackageScript.set(packageScript, entry);
  }
}

for (const [name, command] of Object.entries(pkg.scripts)) {
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
    if (command.includes("archived-smoke")) {
      errors.push(`active smoke package script ${name} routes to archived-smoke`);
    }
  }
  if (
    name.startsWith("proof-") &&
    (entriesByPackageScript.has(name) || command.includes("scripts/smoke/"))
  ) {
    const entry = entriesByPackageScript.get(name);
    if (!entry) {
      errors.push(`proof package script ${name} missing from manifest`);
    }
    if (entry && entry.classification !== "proof-audit") {
      errors.push(`proof package script ${name} is ${entry.classification}, not proof-audit`);
    }
  }
  if (name.startsWith("archive-")) {
    const entry = entriesByPackageScript.get(name);
    if (!entry) {
      errors.push(`archive package script ${name} missing from manifest`);
    }
    if (entry && entry.classification !== "archived") {
      errors.push(`archive package script ${name} is ${entry.classification}, not archived`);
    }
    if (!command.includes("scripts/archived-smoke.mjs")) {
      errors.push(`archive package script ${name} must route through scripts/archived-smoke.mjs`);
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
