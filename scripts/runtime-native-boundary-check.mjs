#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const RUNTIME_SRC = join(ROOT, "packages", "runtime", "src");
const NATIVE_PACKAGES = ["native-arm64-darwin", "native-arm64-linux", "native-x64-linux"];
const SKIP_DIRS = new Set(["__tests__", "dist", "node_modules"]);

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
  supervisorPath: "machinen-supervisor",
  restorePath: "machinen-restore",
  mke2fs: "mke2fs",
  mksquashfs: "mksquashfs",
};

const ROOT_SHELL_MODULES = new Set([
  "errors.ts",
  "index.ts",
  "log.ts",
  "native-hex.ts",
  "phase-timer.ts",
  "target-native-consumption-results.ts",
  "vm-handle.ts",
]);

const HOST_OR_INTEGRATION_GLUE_MODULES = new Set([
  "advanced-linux-facility-probe.ts",
  "balloon-stats.ts",
  "base-assets.ts",
  "cpu-cgroup.ts",
  "detached-log.ts",
  "exec.ts",
  "files.ts",
  "gc.ts",
  "gvproxy.ts",
  "host-mem.ts",
  "mkinitramfs.ts",
  "mount-resolver.ts",
  "mountdisk-img.ts",
  "multiplex.ts",
  "nested-virt.ts",
  "pdeathsig.ts",
  "pid-validate.ts",
  "proc-rss.ts",
  "provision.ts",
  "pty.ts",
  "reflink.ts",
  "registry.ts",
  "rootfs-img.ts",
  "rootfs-template-metadata.ts",
  "secrets.ts",
  "winsize.ts",
]);

const PROOF_OR_POLICY_MODULE_PATTERNS = [/^lazy-pagemap\.ts$/, /^move-pid-graph\.ts$/];

const RUNTIME_TS_ROLE_RULES = [
  ["native-command-wrapper", (rel) => rel.startsWith("native/")],
  ["helper-protocol-boundary", (rel) => rel === "native-helper.ts"],
  ["cli-supervisor-glue", (rel) => rel.startsWith("bin/")],
  ["public-api-shell", (rel) => ROOT_SHELL_MODULES.has(rel)],
  ["vm-orchestration-glue", (rel) => rel.startsWith("vm/")],
  ["host-integration-glue", (rel) => HOST_OR_INTEGRATION_GLUE_MODULES.has(rel)],
  [
    "proof-or-policy-boundary",
    (rel) => PROOF_OR_POLICY_MODULE_PATTERNS.some((pattern) => pattern.test(rel)),
  ],
];

const roleCounts = new Map();
const failures = [];
const runtimeTsFiles = Array.from(walkTsFiles(RUNTIME_SRC));

checkRuntimeHelperBoundary();
checkRuntimeTsShellRoleCoverage();
checkNativePackageManifests();

if (failures.length > 0) {
  console.error(`runtime-native-boundary-check: ${failures.length} issue(s)`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  "runtime-native-boundary-check: runtime native boundaries, TypeScript shell roles, and package manifests are valid",
);
console.log(`runtime-native-boundary-check: TypeScript role coverage ${formatRoleSummary()}`);

function checkRuntimeHelperBoundary() {
  for (const file of runtimeTsFiles) {
    checkRuntimeHelperBoundaryFile(file);
  }
}

function checkRuntimeHelperBoundaryFile(file) {
  const rel = runtimeRel(file);
  const text = readFileSync(file, "utf8");
  const wrapper = rel.startsWith("native/");
  if (wrapper) {
    checkWrapperDoesNotReexportHelper(rel, text);
    return;
  }
  if (rel !== "native-helper.ts") {
    checkProductModuleDoesNotBypassWrapper(rel, text);
  }
}

function checkProductModuleDoesNotBypassWrapper(rel, text) {
  if (/\bcallRuntimeHelper\b/.test(text)) {
    failures.push(
      `${rel} references callRuntimeHelper directly; product modules must use a command-specific wrapper under packages/runtime/src/native/`,
    );
  }
  if (/from\s+["'][^"']*native-helper\.ts["']/.test(text)) {
    failures.push(
      `${rel} imports native-helper.ts directly; add a command-specific wrapper under packages/runtime/src/native/`,
    );
  }
}

function checkWrapperDoesNotReexportHelper(rel, text) {
  if (/export\s*\{[^}]*callRuntimeHelper/.test(text)) {
    failures.push(
      `${rel} re-exports callRuntimeHelper; wrappers must not broaden the public native boundary`,
    );
  }
}

function checkRuntimeTsShellRoleCoverage() {
  for (const file of runtimeTsFiles) {
    checkRuntimeTsShellRoleFile(file);
  }
}

function checkRuntimeTsShellRoleFile(file) {
  const rel = runtimeRel(file);
  const role = classifyRuntimeTsModule(rel);
  if (role === null) {
    failures.push(
      `${rel} has no runtime TypeScript shell role; classify it as a public shell, native wrapper, orchestration glue, host integration glue, or proof/policy boundary`,
    );
    return;
  }
  roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
}

function checkNativePackageManifests() {
  for (const pkgName of NATIVE_PACKAGES) {
    const pkgDir = join(ROOT, "packages", pkgName);
    const manifest = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    const index = readFileSync(join(pkgDir, "index.mjs"), "utf8");
    checkNativePackageBin(pkgName, manifest.bin ?? {});
    checkNativePackageIndex(pkgName, index);
  }
}

function checkNativePackageBin(pkgName, bin) {
  for (const [binName, binPath] of Object.entries(EXPECTED_HOST_BINS)) {
    if (bin[binName] !== binPath) {
      failures.push(`${pkgName}/package.json bin.${binName} must be ${binPath}`);
    }
  }
}

function checkNativePackageIndex(pkgName, index) {
  for (const [exportName, marker] of Object.entries(EXPECTED_INDEX_EXPORTS)) {
    checkNativePackageIndexExport(pkgName, index, exportName, marker);
  }
}

function checkNativePackageIndexExport(pkgName, index, exportName, marker) {
  if (!new RegExp(`export\\s+const\\s+${exportName}\\b`).test(index)) {
    failures.push(`${pkgName}/index.mjs must export ${exportName}`);
  }
  if (!index.includes(marker)) {
    failures.push(`${pkgName}/index.mjs export ${exportName} must reference ${marker}`);
  }
}

function classifyRuntimeTsModule(rel) {
  const rule = RUNTIME_TS_ROLE_RULES.find(([, test]) => test(rel));
  return rule?.[0] ?? null;
}

function formatRoleSummary() {
  return Array.from(roleCounts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([role, count]) => `${role}=${count}`)
    .join(", ");
}

function runtimeRel(file) {
  return relative(RUNTIME_SRC, file).split(sep).join("/");
}

function* walkTsFiles(dir) {
  for (const entry of readdirSync(dir)) {
    yield* walkTsEntry(join(dir, entry), entry);
  }
}

function* walkTsEntry(path, entry) {
  const st = statSync(path);
  if (st.isDirectory()) {
    yield* walkTsDirectory(path, entry);
    return;
  }
  if (isRuntimeTsFile(path, entry)) {
    yield path;
  }
}

function* walkTsDirectory(path, entry) {
  if (!SKIP_DIRS.has(entry)) {
    yield* walkTsFiles(path);
  }
}

function isRuntimeTsFile(path, entry) {
  return entry.endsWith(".ts") && !entry.endsWith(".d.ts") && existsSync(path);
}
