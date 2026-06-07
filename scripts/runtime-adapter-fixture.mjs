#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_FIXTURE = "research/snapshot/runtime-adapter-noop-fixture.json";
const REQUIRED_REFUSALS = [
  "runtime-native-extension-opaque",
  "runtime-opaque-vm-frame",
  "runtime-source-owned-executable-code",
  "runtime-active-socket-without-transport",
  "runtime-worker-sync-model-missing",
  "runtime-app-hook-required",
];

// fallow-ignore-next-line complexity
function validateAdapter(adapter) {
  const errors = [];
  if (adapter.kind !== "machinen.runtime-neutral-adapter") {
    errors.push("kind must be machinen.runtime-neutral-adapter");
  }
  if (!adapter.runtime?.name || !adapter.runtime?.version || !adapter.runtime?.buildId) {
    errors.push("runtime name/version/buildId are required");
  }
  if (!Array.isArray(adapter.semanticStateSections)) {
    errors.push("semanticStateSections must be an array");
  }
  if (!Array.isArray(adapter.nativeResourceRequirements)) {
    errors.push("nativeResourceRequirements must be an array");
  }
  if (!Array.isArray(adapter.targetNativeRestoreRequirements)) {
    errors.push("targetNativeRestoreRequirements must be an array");
  }
  const refusalCodes = new Set((adapter.refusalCases ?? []).map((entry) => entry.code));
  for (const code of REQUIRED_REFUSALS) {
    if (!refusalCodes.has(code)) {
      errors.push(`missing mandatory refusal ${code}`);
    }
  }
  const opaqueRefusal = (adapter.refusalCases ?? []).find(
    (entry) => entry.code === "runtime-native-extension-opaque",
  );
  return {
    passed: errors.length === 0,
    errors,
    adapter: adapter.name,
    supportClaimed: adapter.supportClaimed === true,
    refusalProof: opaqueRefusal
      ? {
          state: "refused",
          migrationCompleted: false,
          descriptorGateCompleted: false,
          refusal: opaqueRefusal,
        }
      : undefined,
  };
}

const json = JSON.parse(readFileSync(resolve(process.argv[2] ?? DEFAULT_FIXTURE), "utf8"));
const result = validateAdapter(json);
console.log(JSON.stringify(result, null, 2));
process.exit(result.passed && result.supportClaimed === false ? 0 : 1);
