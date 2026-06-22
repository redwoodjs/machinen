#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_SRC = join(ROOT, "packages", "runtime", "src");
const NATIVE_PACKAGES = ["native-arm64-darwin", "native-arm64-linux", "native-x64-linux"];

const EXPECTED_HOST_BINS = {
  "machinen-gvproxy": "./vmm/bin/gvproxy",
  "machinen-mke2fs": "./e2fsprogs/bin/mke2fs",
  "machinen-mksquashfs": "./squashfs/bin/mksquashfs",
  "machinen-pdeathsig": "./vmm/bin/machinen-pdeathsig",
  "machinen-pty": "./vmm/bin/machinen-pty",
  "machinen-runtime-helper": "./vmm/bin/machinen-runtime-helper",
  "machinen-vm": "./vmm/bin/machinen-vm",
  "machinen-winsize": "./vmm/bin/machinen-winsize",
};

const EXPECTED_INDEX_EXPORTS = {
  binary: "machinen-vm",
  runtimeHelper: "machinen-runtime-helper",
  pdeathsig: "machinen-pdeathsig",
  pty: "machinen-pty",
  winsize: "machinen-winsize",
  gvproxy: "gvproxy",
  initPath: "init",
  execAgentPath: "exec-agent",
  mke2fs: "mke2fs",
  mksquashfs: "mksquashfs",
};

const failures = [];
checkRuntimeHelperBoundary();
checkNativePackageManifests();

if (failures.length > 0) {
  console.error(`runtime-native-boundary-check: ${failures.length} issue(s)`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  "runtime-native-boundary-check: runtime native boundaries and package manifests are valid",
);

function checkRuntimeHelperBoundary() {
  for (const file of walkTsFiles(RUNTIME_SRC)) {
    const rel = relative(RUNTIME_SRC, file).split(sep).join("/");
    const text = readFileSync(file, "utf8");
    const allowed = rel === "native-helper.ts" || rel.startsWith("native/");
    if (!allowed && /\bcallRuntimeHelper\b/.test(text)) {
      failures.push(
        `${rel} references callRuntimeHelper directly; product modules must use a command-specific wrapper under packages/runtime/src/native/`,
      );
    }
    if (!allowed && /from\s+["'][^"']*native-helper\.ts["']/.test(text)) {
      failures.push(
        `${rel} imports native-helper.ts directly; add a command-specific wrapper under packages/runtime/src/native/`,
      );
    }
    if (rel.startsWith("native/") && /export\s*\{[^}]*callRuntimeHelper/.test(text)) {
      failures.push(
        `${rel} re-exports callRuntimeHelper; wrappers must not broaden the public native boundary`,
      );
    }
  }
}

function checkNativePackageManifests() {
  for (const pkgName of NATIVE_PACKAGES) {
    const pkgDir = join(ROOT, "packages", pkgName);
    const pkgJsonPath = join(pkgDir, "package.json");
    const indexPath = join(pkgDir, "index.mjs");
    const manifest = JSON.parse(readFileSync(pkgJsonPath, "utf8"));
    for (const [binName, binPath] of Object.entries(EXPECTED_HOST_BINS)) {
      if (manifest.bin?.[binName] !== binPath) {
        failures.push(`${pkgName}/package.json bin.${binName} must be ${binPath}`);
      }
    }
    const index = readFileSync(indexPath, "utf8");
    for (const [exportName, marker] of Object.entries(EXPECTED_INDEX_EXPORTS)) {
      if (!new RegExp(`export\\s+const\\s+${exportName}\\b`).test(index)) {
        failures.push(`${pkgName}/index.mjs must export ${exportName}`);
      }
      if (!index.includes(marker)) {
        failures.push(`${pkgName}/index.mjs export ${exportName} must reference ${marker}`);
      }
    }
  }
}

function* walkTsFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) {
      if (entry === "__tests__" || entry === "dist" || entry === "node_modules") {
        continue;
      }
      yield* walkTsFiles(path);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts") && existsSync(path)) {
      yield path;
    }
  }
}
