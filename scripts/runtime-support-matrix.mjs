#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const PROFILE_FILE = join(SCRIPT_DIR, "portable-machine-proof-profiles.json");
const DEFAULT_MANIFEST_DIR = join(REPO_ROOT, "docs/snapshot/runtime-manifests");
const DEFAULT_HARNESS_DIR = join(REPO_ROOT, "docs/snapshot/app-harnesses");

const MANDATORY_RUNTIME_REFUSALS = [
  "runtime-native-extension-opaque",
  "runtime-opaque-vm-frame",
  "runtime-source-owned-executable-code",
  "runtime-active-socket-without-transport",
  "runtime-worker-sync-model-missing",
  "runtime-app-hook-required",
];

const FORBIDDEN_HARNESS_SUCCESS = [
  "app-hook-required",
  "source-isa-execution",
  "sidecar-runtime-success",
  "source-text-replay",
];

function usage(exitCode = 2) {
  console.error(
    `usage: node scripts/runtime-support-matrix.mjs [options]\n\nOptions:\n  --manifest path             Runtime support manifest JSON (repeatable)\n  --manifest-dir path         Directory of runtime manifests\n  --harness path              Application harness JSON (repeatable)\n  --harness-dir path          Directory of application harnesses\n  --summary path              Write summary JSON to path\n  --json                      Emit JSON to stdout`,
  );
  process.exit(exitCode);
}

// fallow-ignore-next-line complexity
function parseArgs(argv) {
  const options = { manifests: [], harnesses: [], json: false };
  const tokens = [...argv];
  while (tokens.length > 0) {
    const arg = tokens.shift();
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage(0);
    }
    applyOption(options, arg, tokens);
  }
  return options;
}

// fallow-ignore-next-line complexity
function applyOption(options, arg, tokens) {
  switch (arg) {
    case "--json":
      options.json = true;
      return;
    case "--manifest":
      options.manifests.push(consumeOptionValue(tokens));
      return;
    case "--manifest-dir":
      options.manifestDir = consumeOptionValue(tokens);
      return;
    case "--harness":
      options.harnesses.push(consumeOptionValue(tokens));
      return;
    case "--harness-dir":
      options.harnessDir = consumeOptionValue(tokens);
      return;
    case "--summary":
      options.summary = consumeOptionValue(tokens);
      return;
    default:
      usage();
  }
}

function consumeOptionValue(tokens) {
  const value = tokens.shift();
  if (!value || value.startsWith("--")) {
    usage();
  }
  return value;
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(path), "utf8"));
}

function jsonFiles(dir) {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name));
}

function loadProfiles() {
  return JSON.parse(
    readFileSync(process.env.PORTABLE_MACHINE_PROOF_PROFILES ?? PROFILE_FILE, "utf8"),
  );
}

function acceptedCapabilities(profiles) {
  return new Map(
    profiles
      .filter((profile) => profile.expectedResult === "success")
      .flatMap((profile) =>
        (profile.capabilities ?? []).map((capability) => [capability, profile.name]),
      ),
  );
}

function proofProfilesByName(profiles) {
  return new Map(profiles.map((profile) => [profile.name, profile]));
}

function sha256Text(value) {
  return createHash("sha256").update(value).digest("hex");
}

// fallow-ignore-next-line complexity
function validateRuntimeManifest(manifest, profileState) {
  const errors = [];
  const warnings = [];
  if (manifest.kind !== "machinen.runtime-support-manifest") {
    errors.push("kind must be machinen.runtime-support-manifest");
  }
  if (!manifest.runtime?.name || !manifest.runtime?.version || !manifest.runtime?.buildId) {
    errors.push("runtime name/version/buildId are required");
  }
  if (manifest.supportClaimed !== false && manifest.supportClaimed !== true) {
    errors.push("supportClaimed must be a boolean");
  }
  const requiredCapabilities = manifest.requiredCapabilities ?? [];
  for (const capability of requiredCapabilities) {
    if (!profileState.accepted.has(capability)) {
      errors.push(`required capability ${capability} is not graduated`);
    }
  }
  const proofRefs = manifest.positiveProofProfiles ?? {};
  if (manifest.supportClaimed === true) {
    for (const capability of requiredCapabilities) {
      const refs = proofRefs[capability] ?? [];
      if (!Array.isArray(refs) || refs.length === 0) {
        errors.push(`positive claim for ${capability} has no proof profile`);
        continue;
      }
      for (const ref of refs) {
        const proof = profileState.byName.get(ref);
        if (
          !proof ||
          proof.expectedResult !== "success" ||
          !(proof.capabilities ?? []).includes(capability)
        ) {
          errors.push(`proof profile ${ref} does not prove ${capability}`);
        }
      }
    }
  }
  const refusalCodes = new Set((manifest.refusalCases ?? []).map((entry) => entry.code));
  for (const code of MANDATORY_RUNTIME_REFUSALS) {
    if (!refusalCodes.has(code)) {
      errors.push(`missing mandatory refusal ${code}`);
    }
  }
  for (const state of manifest.stateClasses ?? []) {
    if (state.requiredCapability && !profileState.accepted.has(state.requiredCapability)) {
      errors.push(
        `state ${state.name} references ungraduated capability ${state.requiredCapability}`,
      );
    }
    if (state.refusalCode && !refusalCodes.has(state.refusalCode)) {
      errors.push(`state ${state.name} refusal code ${state.refusalCode} is not declared`);
    }
  }
  for (const failure of manifest.provenanceFailures ?? []) {
    if (failure.migrationCompleted !== false) {
      errors.push(`provenance failure ${failure.code} must keep migrationCompleted=false`);
    }
  }
  if (manifest.supportClaimed === false) {
    warnings.push("planning-only: no runtime family support claimed");
  }
  return { errors, warnings };
}

// fallow-ignore-next-line complexity
function runtimeResult(manifest, profileState, startedAt) {
  const validation = validateRuntimeManifest(manifest, profileState);
  const pass = validation.errors.length === 0;
  const workDir = join(
    tmpdir(),
    `machinen-runtime-${manifest.runtime?.name ?? "unknown"}-${sha256Text(JSON.stringify(manifest)).slice(0, 8)}`,
  );
  const refusalProofs = (manifest.refusalCases ?? []).map((refusal) => ({
    code: refusal.code,
    state: "refused",
    migrationCompleted: false,
    descriptorGateCompleted: false,
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
  }));
  return {
    manifest: manifest.name,
    runtime: manifest.runtime,
    supportClaimed: manifest.supportClaimed === true,
    state: pass ? (manifest.supportClaimed ? "supported-subset" : "planning-only") : "failed",
    pass,
    errors: validation.errors,
    warnings: validation.warnings,
    requiredCapabilities: manifest.requiredCapabilities ?? [],
    capabilityCoverage: Object.fromEntries(
      (manifest.requiredCapabilities ?? []).map((capability) => [
        capability,
        profileState.accepted.get(capability) ?? null,
      ]),
    ),
    gates: manifest.expectedGates ?? [],
    refusalCodes: (manifest.refusalCases ?? []).map((refusal) => refusal.code),
    refusalProofs,
    provenance: manifest.provenance,
    timings: [
      {
        name: manifest.name ?? manifest.runtime?.name,
        status: pass ? "ok" : "failed",
        ms: Date.now() - startedAt,
      },
    ],
    workDir,
  };
}

// fallow-ignore-next-line complexity
function validateHarness(harness, runtimeResults, profileState) {
  const errors = [];
  if (harness.kind !== "machinen.application-harness") {
    errors.push("kind must be machinen.application-harness");
  }
  for (const forbidden of FORBIDDEN_HARNESS_SUCCESS) {
    if ((harness.successProhibitions ?? []).includes(forbidden) === false) {
      errors.push(`harness must prohibit ${forbidden}`);
    }
  }
  if ((harness.correctnessHooks ?? []).length > 0) {
    errors.push("correctness hooks are forbidden");
  }
  for (const capability of harness.requiredCapabilities ?? []) {
    if (!profileState.accepted.has(capability)) {
      errors.push(`harness requires ungraduated capability ${capability}`);
    }
  }
  const runtime = runtimeResults.find((result) => result.manifest === harness.runtimeManifest);
  if (
    harness.expectedResult === "success" &&
    (!runtime || runtime.supportClaimed !== true || !runtime.pass)
  ) {
    errors.push("positive harness requires a passing runtime positive support manifest");
  }
  return {
    harness: harness.name,
    runtimeManifest: harness.runtimeManifest,
    expectedResult: harness.expectedResult,
    pass: errors.length === 0,
    state: errors.length === 0 ? "accepted" : "failed",
    errors,
  };
}

function output(summary, options) {
  if (options.summary) {
    mkdirSync(dirname(resolve(options.summary)), { recursive: true });
    writeFileSync(resolve(options.summary), JSON.stringify(summary, null, 2));
  }
  if (options.json || !options.summary) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

// fallow-ignore-next-line complexity
function main() {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  const profiles = loadProfiles();
  const profileState = {
    accepted: acceptedCapabilities(profiles),
    byName: proofProfilesByName(profiles),
  };
  const manifestPaths = (
    options.manifests.length > 0
      ? options.manifests
      : jsonFiles(resolve(options.manifestDir ?? DEFAULT_MANIFEST_DIR))
  ).sort();
  const harnessPaths = (
    options.harnesses.length > 0
      ? options.harnesses
      : jsonFiles(resolve(options.harnessDir ?? DEFAULT_HARNESS_DIR))
  ).sort();
  const runtimeResults = manifestPaths.map((path) =>
    runtimeResult(readJson(path), profileState, startedAt),
  );
  const harnessResults = harnessPaths.map((path) =>
    validateHarness(readJson(path), runtimeResults, profileState),
  );
  const failed = [...runtimeResults, ...harnessResults].filter((result) => !result.pass);
  const summary = {
    kind: "machinen.runtime-support-matrix",
    state: failed.length === 0 ? "completed" : "failed",
    pass: failed.length === 0,
    runtimeCounts: {
      total: runtimeResults.length,
      planningOnly: runtimeResults.filter((result) => result.state === "planning-only").length,
      supportedSubsets: runtimeResults.filter((result) => result.state === "supported-subset")
        .length,
      failed: runtimeResults.filter((result) => !result.pass).length,
    },
    acceptedCapabilityCount: profileState.accepted.size,
    manifests: runtimeResults,
    appHarnesses: harnessResults,
    workdirs: Object.fromEntries(runtimeResults.map((result) => [result.manifest, result.workDir])),
    timings: [
      {
        name: "runtime-support-matrix",
        status: failed.length === 0 ? "ok" : "failed",
        ms: Date.now() - startedAt,
      },
      ...runtimeResults.flatMap((result) => result.timings),
    ],
  };
  output(summary, options);
  process.exit(summary.pass ? 0 : 1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
