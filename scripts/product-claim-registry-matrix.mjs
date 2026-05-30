#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildProductClaimRegistry,
  filterProductClaimRegistry,
  productClaimFamilies,
  productClaimRefusalSummary,
  productClaimStatuses,
  productSupportLevels,
} from "../packages/runtime/dist/index.js";

const PROFILE_FILE = resolve("scripts/portable-machine-proof-profiles.json");
const VALUE_FLAGS = new Set([
  "--family",
  "--status",
  "--runtime",
  "--profile",
  "--refusal-code",
  "--level",
  "--summary",
]);

function usage() {
  console.error(
    "usage: node scripts/product-claim-registry-matrix.mjs [--family name] [--status status] [--runtime runtime] [--profile name] [--refusal-code code] [--level support-level] [--summary file] [--json]",
  );
  process.exit(2);
}

// fallow-ignore-next-line complexity
function parseArgs(argv) {
  const options = { json: false };
  // fallow-ignore-next-line code-duplication
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (VALUE_FLAGS.has(arg)) {
      options[arg.slice(2).replaceAll("-", "_")] = valueAfterFlag(argv, index);
      index += 1;
      continue;
    }
    usage();
  }
  if (options.family && !productClaimFamilies.includes(options.family)) {
    usage();
  }
  if (options.status && !productClaimStatuses.includes(options.status)) {
    usage();
  }
  if (options.level && !productSupportLevels.includes(options.level)) {
    usage();
  }
  return options;
}

function valueAfterFlag(argv, index) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    usage();
  }
  return value;
}

// fallow-ignore-next-line complexity
function validateRegistry(registry, selected) {
  const failures = [];
  if (registry.entries.length === 0) {
    failures.push("registry has no entries");
  }
  if (registry.summary.total !== registry.entries.length) {
    failures.push("registry summary total does not match entry count");
  }
  const implemented = registry.entries.filter(
    (entry) => entry.productStatus === "implemented-product-support",
  );
  const implementedNames = new Set(implemented.map((entry) => entry.name));
  for (const required of [
    "node-app-http-server-recreate",
    "python-cross-arch-runtime-policy",
    "go-cross-arch-runtime-policy",
    "ping-level4-socket-reconstruction-v1",
    "eventfd-counter-v1-nonsemaphore-no-waiters",
    "pipe-pair-v1-empty-no-waiters",
    "timerfd-relative-oneshot-v1-monotonic",
    "tcp-listener-v1-loopback-empty-accept-queue",
  ]) {
    if (!implementedNames.has(required)) {
      failures.push(`implemented product subset is missing: ${required}`);
    }
  }
  if (implemented.length !== 8) {
    failures.push(
      "implemented product support must be exactly the clean-service Node, Python, Go routes and the portable-machine Level 4 ping, eventfd, pipe, timerfd, and TCP listener routes",
    );
  }
  if (implemented.some((entry) => entry.supportLevel === "level-2-semantic-continuation")) {
    failures.push("Level 2 semantic ping must not be reported as implemented product support");
  }
  if (
    registry.entries.some(
      (entry) =>
        entry.name === "node-v8-libuv-single-thread-http-v1" &&
        (entry.productStatus === "implemented-product-support" || entry.migrationCompleted),
    )
  ) {
    failures.push(
      "selected-state Node HTTP counter harness must not be reported as product support",
    );
  }
  if (
    !implemented.some(
      (entry) =>
        entry.name === "ping-level4-socket-reconstruction-v1" &&
        entry.supportLevel === "level-4-kernel-resource-reconstruction",
    )
  ) {
    failures.push("implemented ping socket profile is not reported as Level 4 support");
  }
  if (
    !implemented.some(
      (entry) =>
        entry.name === "eventfd-counter-v1-nonsemaphore-no-waiters" &&
        entry.supportLevel === "level-4-kernel-resource-reconstruction",
    )
  ) {
    failures.push("implemented eventfd profile is not reported as Level 4 support");
  }
  if (
    !implemented.some(
      (entry) =>
        entry.name === "pipe-pair-v1-empty-no-waiters" &&
        entry.supportLevel === "level-4-kernel-resource-reconstruction",
    )
  ) {
    failures.push("implemented pipe profile is not reported as Level 4 support");
  }
  if (
    !implemented.some(
      (entry) =>
        entry.name === "timerfd-relative-oneshot-v1-monotonic" &&
        entry.supportLevel === "level-4-kernel-resource-reconstruction",
    )
  ) {
    failures.push("implemented timerfd profile is not reported as Level 4 support");
  }
  if (
    !implemented.some(
      (entry) =>
        entry.name === "tcp-listener-v1-loopback-empty-accept-queue" &&
        entry.supportLevel === "level-4-kernel-resource-reconstruction",
    )
  ) {
    failures.push("implemented TCP listener profile is not reported as Level 4 support");
  }
  for (const entry of registry.entries) {
    if (
      entry.productStatus !== "implemented-product-support" &&
      entry.migrationCompleted !== false
    ) {
      failures.push(`${entry.name} is not implemented but migrationCompleted is not false`);
    }
    if (entry.productStatus === "proof-only-fixture" && entry.descriptorRequired) {
      failures.push(`${entry.name} is proof-only but descriptorRequired=true`);
    }
    if (entry.productStatus === "stable-product-refusal") {
      const refusal = productClaimRefusalSummary(entry);
      if (!refusal || refusal.migrationCompleted !== false || refusal.targetState !== "refused") {
        failures.push(`${entry.name} does not produce a stable product refusal summary`);
      }
    }
  }
  for (const family of [
    "nodejs",
    "go",
    "python-ruby-jvm",
    "stateful-services",
    "foundation-native",
    "native-linux-resource",
    "network-ping-socket",
  ]) {
    if (registry.summary.byFamily[family] <= 0) {
      failures.push(`family ${family} has no classified entries`);
    }
  }
  if (
    !registry.entries.some(
      (entry) => entry.name.includes("ping") && entry.family === "network-ping-socket",
    )
  ) {
    failures.push("ping profiles are not visible through network-ping-socket product discovery");
  }
  if (
    !registry.entries.some(
      (entry) => entry.name.includes("raw-icmp") && entry.family === "network-ping-socket",
    )
  ) {
    failures.push(
      "raw ICMP profiles are not visible through network-ping-socket product discovery",
    );
  }
  if (selected.length === 0) {
    failures.push("selected filter returned no entries");
  }
  return failures;
}

const options = parseArgs(process.argv.slice(2));
const profiles = JSON.parse(readFileSync(PROFILE_FILE, "utf8"));
const registry = buildProductClaimRegistry(profiles);
const selected = filterProductClaimRegistry(registry.entries, {
  family: options.family,
  runtime: options.runtime,
  status: options.status,
  profile: options.profile,
  refusalCode: options.refusal_code,
  supportLevel: options.level,
});
const failures = validateRegistry(registry, selected);
const summary = {
  kind: "machinen.product-claim-registry-matrix",
  state: failures.length === 0 ? "completed" : "failed",
  pass: failures.length === 0,
  filters: {
    family: options.family,
    runtime: options.runtime,
    status: options.status,
    profile: options.profile,
    refusalCode: options.refusal_code,
    level: options.level,
  },
  registrySummary: registry.summary,
  selectedCount: selected.length,
  selectedSample: selected.slice(0, 20),
  failures,
};

// fallow-ignore-next-line code-duplication
if (options.summary) {
  writeFileSync(resolve(options.summary), `${JSON.stringify(summary, null, 2)}\n`);
}
if (options.json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else if (summary.pass) {
  process.stdout.write(
    `product claim registry matrix passed: ${registry.summary.total} profiles, ${selected.length} selected\n`,
  );
} else {
  process.stderr.write(`${JSON.stringify(summary, null, 2)}\n`);
}
process.exit(summary.pass ? 0 : 1);
