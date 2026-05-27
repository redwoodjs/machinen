#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatePortableMachineProofProfiles } from "./portable-machine-proof-runner.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const PROFILE_FILE = join(SCRIPT_DIR, "portable-machine-proof-profiles.json");
const RUNNER = join(SCRIPT_DIR, "portable-machine-proof-runner.mjs");
const DEFAULT_TIMEOUT_MS = 900_000;

const PRESETS = {
  "baseline-success": (profiles) =>
    profiles.filter((profile) => profile.supportStatus === "baseline-success"),
  "graduated-support": (profiles) =>
    profiles.filter((profile) => profile.supportStatus === "graduated-support"),
  positive: (profiles) => profiles.filter((profile) => profile.expectedResult === "success"),
  "all-positive": (profiles) => profiles.filter((profile) => profile.expectedResult === "success"),
  refusal: (profiles) => profiles.filter((profile) => profile.expectedResult === "refusal"),
  "refusal-matrix": (profiles) =>
    profiles.filter((profile) => profile.expectedResult === "refusal"),
  "foundation-full": (profiles) => profiles,
  "goal-6-7-full-foundation": (profiles) => profiles,
  "real-workload": (profiles) => profiles.filter((profile) => isRealWorkloadProfile(profile)),
  "real-workload-positive": (profiles) =>
    profiles.filter(
      (profile) => isRealWorkloadProfile(profile) && profile.expectedResult === "success",
    ),
  goal21: (profiles) => profiles.filter((profile) => hasGoalCapability(profile, "goal21")),
  "goal21-positive": (profiles) =>
    profiles.filter(
      (profile) => hasGoalCapability(profile, "goal21") && profile.expectedResult === "success",
    ),
  "goal21-refusal": (profiles) =>
    profiles.filter(
      (profile) => hasGoalCapability(profile, "goal21") && profile.expectedResult === "refusal",
    ),
  goal26: (profiles) => profiles.filter((profile) => hasGoalCapability(profile, "goal26")),
  "goal26-positive": (profiles) =>
    profiles.filter(
      (profile) => hasGoalCapability(profile, "goal26") && profile.expectedResult === "success",
    ),
  "goal26-refusal": (profiles) =>
    profiles.filter(
      (profile) => hasGoalCapability(profile, "goal26") && profile.expectedResult === "refusal",
    ),
  node: (profiles) => profiles.filter((profile) => hasRuntimeCapability(profile, "node")),
  "node-positive": (profiles) =>
    profiles.filter(
      (profile) => hasRuntimeCapability(profile, "node") && profile.expectedResult === "success",
    ),
  "node-refusal": (profiles) =>
    profiles.filter(
      (profile) => hasRuntimeCapability(profile, "node") && profile.expectedResult === "refusal",
    ),
  invalidation: (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "invalidation:")),
  "invalidation-positive": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "invalidation:") && profile.expectedResult === "success",
    ),
  "invalidation-refusal": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "invalidation:") && profile.expectedResult === "refusal",
    ),
  "invalidation-work": (profiles) =>
    profiles.filter(
      (profile) => hasCapabilityPrefix(profile, "invalidation:") && hasRefreshSupport(profile),
    ),
  "invalidation-work-positive": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "invalidation:") &&
        hasRefreshSupport(profile) &&
        profile.expectedResult === "success",
    ),
  "node-invalidation": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:invalidation:")),
  "node-invalidation-refusal": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "runtime:node:invalidation:") &&
        profile.expectedResult === "refusal",
    ),
  "node-invalidation-work": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "runtime:node:invalidation:") && hasRefreshSupport(profile),
    ),
  "node-apps": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:app:")),
  "node-apps-supported": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "runtime:node:app:") && profile.expectedResult === "success",
    ),
  "node-real-apps": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:app:")),
  "node-real-apps-positive": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "runtime:node:app:") && profile.expectedResult === "success",
    ),
  "node-real-cli": (profiles) => profiles.filter((profile) => hasNodeApp(profile, "cli-script")),
  "node-real-cjs": (profiles) =>
    profiles.filter((profile) => hasNodeApp(profile, "commonjs-package")),
  "node-real-esm": (profiles) => profiles.filter((profile) => hasNodeApp(profile, "esm-package")),
  "node-real-timers-async": (profiles) =>
    profiles.filter((profile) => hasNodeApp(profile, "timers-async")),
  "node-real-fs-stdio": (profiles) => profiles.filter((profile) => hasNodeApp(profile, "fs-stdio")),
  "node-real-http-tcp": (profiles) =>
    profiles.filter((profile) => hasNodeApp(profile, "http-server")),
  "node-real-udp-dns": (profiles) => profiles.filter((profile) => hasNodeApp(profile, "udp-dns")),
  "node-real-worker": (profiles) =>
    profiles.filter((profile) => hasNodeApp(profile, "worker-thread")),
  "node-real-native-addon": (profiles) =>
    profiles.filter((profile) => hasNodeApp(profile, "native-addon")),
  "node-real-crypto-tls": (profiles) =>
    profiles.filter((profile) => hasNodeApp(profile, "crypto-tls")),
  "node-live": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:app:")),
  "node-live-positive": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "runtime:node:app:") && profile.expectedResult === "success",
    ),
  "node-live-refusal": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "runtime:node:live-refusal:") &&
        profile.expectedResult === "refusal",
    ),
  "node-live-apps": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:app:")),
  "node-live-real-world": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:app:")),
  "node-live-local-to-proxmox": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:app:")),
  "node-live-remote-builder-to-proxmox": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:app:")),
  "node-expanded": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:expanded:")),
  "node-expanded-arbitrary-existing": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:expanded:arbitrary-existing-processes"),
    ),
  "node-expanded-active-http-tcp": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:expanded:active-http-tcp-preservation"),
    ),
  "node-expanded-child-process-ipc": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:expanded:child-process-ipc-trees"),
    ),
  "node-expanded-inspector": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:expanded:inspector-debugging-policy"),
    ),
  "node-expanded-dirty-state": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:expanded:ambiguous-dirty-state-policy"),
    ),
  "node-expanded-native-addon-abi": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:expanded:broad-native-addon-abi"),
    ),
  "node-expanded-amd64-to-arm64": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:expanded:amd64-to-arm64-route"),
    ),
  "node-complex": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:complex:")),
  "node-complex-frameworks": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:complex:framework-apps"),
    ),
  "node-complex-persistence": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:complex:persistence-systems"),
    ),
  "node-complex-networking": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:complex:websocket-tls-keepalive"),
    ),
  "node-complex-topology": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:complex:cluster-worker-supervisor"),
    ),
  "node-complex-native": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:complex:published-native-addons"),
    ),
  "node-complex-load-failure": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:complex:load-failure-repeatability"),
    ),
  "node-complex-os-runtime": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:complex:os-runtime-architecture"),
    ),
  "node-ecosystem": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:ecosystem:")),
  "node-ecosystem-local-registry": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:ecosystem:local-audited-registry"),
    ),
  "node-ecosystem-native-prebuild": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:ecosystem:native-prebuild-layout"),
    ),
  "node-ecosystem-lockfile-sbom": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:ecosystem:lockfile-sbom-provenance"),
    ),
  "node-ecosystem-sandbox": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:ecosystem:no-network-no-scripts-sandbox"),
    ),
  "node-ecosystem-app": (profiles) =>
    profiles.filter((profile) =>
      hasCapabilityPrefix(profile, "runtime:node:ecosystem:app-restore"),
    ),
  "non-node-runtimes": (profiles) =>
    profiles.filter((profile) =>
      hasAnyCapabilityPrefix(profile, [
        "runtime:jvm:goal38:",
        "runtime:python:goal38:",
        "runtime:ruby:goal38:",
        "runtime:go:goal38:",
        "runtime:cross:goal38:",
      ]),
    ),
  "runtime-jvm": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:jvm:goal38:")),
  "runtime-python": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:python:goal38:")),
  "runtime-ruby": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:ruby:goal38:")),
  "runtime-go": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:go:goal38:")),
  "runtime-cross-comparison": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:cross:goal38:")),
  "non-node-cross-arch": (profiles) =>
    profiles.filter((profile) =>
      hasAnyCapabilityPrefix(profile, [
        "runtime:python:goal39:cross-arch",
        "runtime:go:goal39:cross-arch",
      ]),
    ),
  "runtime-python-cross-arch": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:python:goal39:cross-arch")),
  "runtime-go-cross-arch": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:go:goal39:cross-arch")),
  "goal40-hard-state": (profiles) =>
    profiles.filter((profile) =>
      hasAnyCapabilityPrefix(profile, [
        "runtime:network:goal40:",
        "runtime:native-extension:goal40:",
        "runtime:go:goal40:",
        "runtime:hard-state:goal40:",
      ]),
    ),
  "goal40-active-socket-tls": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:network:goal40:")),
  "goal40-native-extension": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:native-extension:goal40:")),
  "goal40-go-scheduler": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:go:goal40:")),
  "goal40-refusal": (profiles) =>
    profiles.filter(
      (profile) =>
        profile.proofCategory === "goal40-hard-runtime-state-refusal" ||
        hasAnyCapabilityPrefix(profile, [
          "runtime:network:goal40:",
          "runtime:native-extension:goal40:",
          "runtime:go:goal40:arbitrary-scheduler",
        ]),
    ),
  "goal41-refusal": (profiles) =>
    profiles.filter((profile) => hasAnyCapabilityPrefix(profile, ["runtime:goal41:"])),
  "goal41-active-network-tls": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:goal41:network:")),
  "goal41-native-extension": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:goal41:native-extension:")),
  "goal41-go-scheduler": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:goal41:go-scheduler:")),
  "go-quiescent-runtime": (profiles) =>
    profiles.filter((profile) => hasAnyCapabilityPrefix(profile, ["runtime:go:goal42:"])),
  "go-quiescent-positive": (profiles) =>
    profiles.filter(
      (profile) =>
        profile.expectedResult === "success" &&
        hasAnyCapabilityPrefix(profile, ["runtime:go:goal42:"]),
    ),
  "go-quiescent-refusal": (profiles) =>
    profiles.filter(
      (profile) =>
        profile.proofCategory === "goal42-go-quiescent-refusal" ||
        (profile.expectedResult === "refusal" &&
          hasAnyCapabilityPrefix(profile, ["runtime:go:goal42:"])),
    ),
  "postgres-machinen": (profiles) =>
    profiles.filter((profile) => hasAnyCapabilityPrefix(profile, ["runtime:postgres:goal43:"])),
  "postgres-machinen-positive": (profiles) =>
    profiles.filter(
      (profile) =>
        profile.expectedResult === "success" &&
        hasAnyCapabilityPrefix(profile, ["runtime:postgres:goal43:"]),
    ),
  "postgres-machinen-refusal": (profiles) =>
    profiles.filter(
      (profile) =>
        profile.proofCategory === "goal43-postgres-refusal" ||
        (profile.expectedResult === "refusal" &&
          hasAnyCapabilityPrefix(profile, ["runtime:postgres:goal43:"])),
    ),
  "stateful-services": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "stateful:goal44:")),
  "stateful-services-positive": (profiles) =>
    profiles.filter(
      (profile) =>
        profile.expectedResult === "success" && hasCapabilityPrefix(profile, "stateful:goal44:"),
    ),
  "stateful-services-refusal": (profiles) =>
    profiles.filter(
      (profile) =>
        profile.expectedResult === "refusal" && hasCapabilityPrefix(profile, "stateful:goal44:"),
    ),
  "stateful-redis": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "stateful:goal44:redis:")),
  "stateful-sqlite": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "stateful:goal44:sqlite:")),
  "stateful-postgres": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "stateful:goal44:postgres:")),
  "stateful-mariadb": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "stateful:goal44:mariadb:")),
  "stateful-queue": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "stateful:goal44:queue:")),
  "stateful-filesystem": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "stateful:goal44:filesystem:")),
  "node-blockers": (profiles) =>
    profiles.filter((profile) => hasCapabilityPrefix(profile, "runtime:node:blocker:")),
  "node-blockers-refusal": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "runtime:node:blocker:") &&
        profile.expectedResult === "refusal",
    ),
  "node-blockers-supported": (profiles) =>
    profiles.filter(
      (profile) =>
        hasCapabilityPrefix(profile, "runtime:node:blocker:") &&
        profile.expectedResult === "success",
    ),
  "node-native-addon": (profiles) =>
    profiles.filter((profile) => hasNodeBlockerFamily(profile, "native-addon")),
  "node-workers": (profiles) =>
    profiles.filter((profile) => hasNodeBlockerFamily(profile, "workers")),
  "node-async": (profiles) => profiles.filter((profile) => hasNodeBlockerFamily(profile, "async")),
  "node-timers": (profiles) =>
    profiles.filter((profile) => hasNodeBlockerFamily(profile, "timers")),
  "node-network": (profiles) =>
    profiles.filter((profile) => hasNodeBlockerFamily(profile, "network")),
  "node-fs-stdio": (profiles) =>
    profiles.filter((profile) => hasNodeBlockerFamily(profile, "fs-stdio")),
  "node-v8-heap": (profiles) =>
    profiles.filter((profile) => hasNodeBlockerFamily(profile, "v8-heap")),
  "node-module-graph": (profiles) =>
    profiles.filter((profile) => hasNodeBlockerFamily(profile, "module-graph")),
  "node-process-signal": (profiles) =>
    profiles.filter((profile) => hasNodeBlockerFamily(profile, "process-signal")),
  "node-identity-invalidation": (profiles) =>
    profiles.filter((profile) => hasNodeBlockerFamily(profile, "identity-invalidation")),
};

const PASS_THROUGH_OPTIONS = new Set([
  "--arm64-ssh",
  "--amd64-ssh",
  "--amd64-repo",
  "--target-image",
  "--amd64-vmm",
  "--amd64-kernel",
  "--amd64-assets-dir",
  "--amd64-path-prefix",
]);

function usage(exitCode = 2) {
  console.error(
    `usage: node scripts/portable-machine-proof-matrix.mjs [options]\n\nOptions:\n  --preset name               baseline-success, graduated-support, positive, refusal, foundation-full, real-workload, goal21\n  --support-status status     Select profiles by supportStatus (repeatable or comma-separated)\n  --capability capability     Select profiles by capabilities/refusesCapabilities\n  --unsafe-family family      Select profiles by unsafeStateFamily\n  --profile name              Explicit profile (repeatable or comma-separated)\n  --check-summary-dir path    Verify existing <profile>.json summaries instead of running profiles\n  --summary-cache-dir path    Reuse existing <profile>.json smoke summaries and save newly run ones\n  --save-summary-dir path     Save reusable smoke summaries for newly run profiles\n  --artifact-inventory path   Write flattened artifact inventory JSON\n  --shard index/count         Run one 1-based shard of the selected profiles, e.g. 1/4\n  --summary path              Write summary JSON to path\n  --json                      Emit summary JSON to stdout\n  --dry-run                   Pass --dry-run to the underlying proof runner\n  --continue-on-fail          Run all selected profiles after a failure\n  --work-dir-prefix path      Prefix for profile work directories\n  --timeout-ms ms             Per-profile timeout (default: ${DEFAULT_TIMEOUT_MS})`,
  );
  process.exit(exitCode);
}

function readValue(argv, index) {
  const nextIndex = index + 1;
  const value = argv.at(nextIndex);
  if (value === undefined || value.slice(0, 2) === "--") {
    usage();
  }
  return [value, nextIndex];
}

function pushCsv(target, value) {
  const values = value.split(",");
  for (const raw of values) {
    const item = raw.trim();
    if (item.length > 0) {
      target.push(item);
    }
  }
}

function parseShard(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) {
    usage();
  }
  const index = Number(match[1]);
  const count = Number(match[2]);
  validateShardParts(index, count);
  return { index: index - 1, count, label: value };
}

function validateShardParts(index, count) {
  if (!isValidShardParts(index, count)) {
    usage();
  }
}

function isValidShardParts(index, count) {
  return isPositiveSafeInteger(index) && isPositiveSafeInteger(count) && index <= count;
}

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

// fallow-ignore-next-line complexity
function parseArgs(argv) {
  const options = {
    presets: [],
    supportStatuses: [],
    capabilities: [],
    unsafeFamilies: [],
    profiles: [],
    runnerOptions: [],
    json: false,
    dryRun: false,
    continueOnFail: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      usage(0);
    }
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--continue-on-fail") {
      options.continueOnFail = true;
    } else if (arg === "--preset") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.presets, value);
      index = next;
    } else if (arg === "--support-status") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.supportStatuses, value);
      index = next;
    } else if (arg === "--capability") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.capabilities, value);
      index = next;
    } else if (arg === "--unsafe-family") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.unsafeFamilies, value);
      index = next;
    } else if (arg === "--profile") {
      const [value, next] = readValue(argv, index);
      pushCsv(options.profiles, value);
      index = next;
    } else if (arg === "--summary") {
      [options.summary, index] = readValue(argv, index);
    } else if (arg === "--check-summary-dir") {
      [options.checkSummaryDir, index] = readValue(argv, index);
    } else if (arg === "--summary-cache-dir") {
      [options.summaryCacheDir, index] = readValue(argv, index);
    } else if (arg === "--save-summary-dir") {
      [options.saveSummaryDir, index] = readValue(argv, index);
    } else if (arg === "--artifact-inventory") {
      [options.artifactInventory, index] = readValue(argv, index);
    } else if (arg === "--shard") {
      const [value, next] = readValue(argv, index);
      options.shard = parseShard(value);
      index = next;
    } else if (arg === "--work-dir-prefix") {
      [options.workDirPrefix, index] = readValue(argv, index);
    } else if (arg === "--timeout-ms") {
      const [value, next] = readValue(argv, index);
      options.timeoutMs = Number(value);
      index = next;
    } else if (PASS_THROUGH_OPTIONS.has(arg)) {
      const [value, next] = readValue(argv, index);
      options.runnerOptions.push(arg, value);
      index = next;
    } else {
      usage();
    }
  }
  return options;
}

function loadProfiles() {
  return JSON.parse(
    readFileSync(process.env.PORTABLE_MACHINE_PROOF_PROFILES ?? PROFILE_FILE, "utf8"),
  );
}

function isRealWorkloadProfile(profile) {
  return profile.sourceFixture?.startsWith("real:") || profile.name.startsWith("real-");
}

function hasGoalCapability(profile, goalPrefix) {
  return [...(profile.capabilities ?? []), ...(profile.refusesCapabilities ?? [])].some(
    (capability) => capability.startsWith(`${goalPrefix}:`),
  );
}

function hasRuntimeCapability(profile, runtimeName) {
  return hasCapabilityPrefix(profile, `runtime:${runtimeName}:`);
}

function hasCapabilityPrefix(profile, prefix) {
  return [...(profile.capabilities ?? []), ...(profile.refusesCapabilities ?? [])].some(
    (capability) => capability.startsWith(prefix),
  );
}

function hasAnyCapabilityPrefix(profile, prefixes) {
  return prefixes.some((prefix) => hasCapabilityPrefix(profile, prefix));
}

function hasRefreshSupport(profile) {
  return (profile.capabilities ?? []).some((capability) => capability.endsWith(":refresh"));
}

function hasNodeBlockerFamily(profile, family) {
  return hasCapabilityPrefix(profile, `runtime:node:blocker:${family}`);
}

function hasNodeApp(profile, appName) {
  return hasCapabilityPrefix(profile, `runtime:node:app:${appName}`);
}

function uniqProfiles(profiles) {
  const seen = new Set();
  return profiles.filter((profile) => {
    if (seen.has(profile.name)) {
      return false;
    }
    seen.add(profile.name);
    return true;
  });
}

// fallow-ignore-next-line complexity
function selectProfiles(profiles, options) {
  const selected = [];
  for (const preset of options.presets) {
    const select = PRESETS[preset];
    if (!select) {
      throw new Error(`unknown matrix preset ${preset}`);
    }
    selected.push(...select(profiles));
  }
  if (options.supportStatuses.length > 0) {
    selected.push(
      ...profiles.filter((profile) => options.supportStatuses.includes(profile.supportStatus)),
    );
  }
  if (options.capabilities.length > 0) {
    selected.push(
      ...profiles.filter((profile) => {
        const caps = [...(profile.capabilities ?? []), ...(profile.refusesCapabilities ?? [])];
        return options.capabilities.some((capability) => caps.includes(capability));
      }),
    );
  }
  if (options.unsafeFamilies.length > 0) {
    selected.push(
      ...profiles.filter((profile) => options.unsafeFamilies.includes(profile.unsafeStateFamily)),
    );
  }
  if (options.profiles.length > 0) {
    for (const name of options.profiles) {
      const profile = profiles.find((candidate) => candidate.name === name);
      if (!profile) {
        throw new Error(`unknown profile ${name}`);
      }
      selected.push(profile);
    }
  }
  const hadExplicitSelection =
    options.presets.length > 0 ||
    options.supportStatuses.length > 0 ||
    options.capabilities.length > 0 ||
    options.unsafeFamilies.length > 0 ||
    options.profiles.length > 0;
  return uniqProfiles(
    selected.length > 0 || hadExplicitSelection ? selected : PRESETS["foundation-full"](profiles),
  );
}

function applyShard(profiles, shard) {
  if (!shard) {
    return profiles;
  }
  return profiles.filter((_, index) => index % shard.count === shard.index);
}

function summaryPath(dir, profile) {
  return join(resolve(dir), `${profile.name}.json`);
}

function checkSummaryPath(profile, options) {
  if (options.checkSummaryDir) {
    return summaryPath(options.checkSummaryDir, profile);
  }
  if (options.summaryCacheDir) {
    const path = summaryPath(options.summaryCacheDir, profile);
    return existsSync(path) ? path : undefined;
  }
  return undefined;
}

function runnerArgs(profile, options, index) {
  const args = [
    RUNNER,
    "--profile",
    profile.name,
    "--json",
    "--timeout-ms",
    String(options.timeoutMs),
  ];
  if (options.dryRun) {
    args.push("--dry-run");
  }
  const checkedSummary = checkSummaryPath(profile, options);
  if (checkedSummary) {
    args.push("--check-summary", checkedSummary);
  }
  const prefix = options.workDirPrefix ?? join(tmpdir(), "machinen-proof-matrix-");
  args.push("--work-dir-prefix", `${resolve(prefix)}${index}-${profile.name}-`);
  args.push(...options.runnerOptions);
  return args;
}

function saveReusableSummary(profile, options, summary) {
  const targetDir = options.saveSummaryDir ?? options.summaryCacheDir;
  if (!targetDir || !summary.smokeSummary) {
    return undefined;
  }
  const path = summaryPath(targetDir, profile);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(summary.smokeSummary, null, 2)}\n`);
  return path;
}

// fallow-ignore-next-line complexity
function runOne(profile, options, index) {
  const startedAt = Date.now();
  const checkedSummary = checkSummaryPath(profile, options);
  const args = runnerArgs(profile, options, index);
  const child = spawnSync("node", args, {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    timeout: options.timeoutMs + 30_000,
  });
  let summary;
  try {
    summary = JSON.parse(child.stdout);
  } catch (error) {
    summary = {
      profile: profile.name,
      state: "failed",
      pass: false,
      failure: error instanceof Error ? error.message : String(error),
      stdout: child.stdout,
      stderr: child.stderr,
    };
  }
  const savedSummaryPath = saveReusableSummary(profile, options, summary);
  return {
    profile: profile.name,
    supportStatus: profile.supportStatus,
    expectedResult: profile.expectedResult,
    pass: child.status === 0 && summary.pass === true,
    state: summary.state ?? "failed",
    exitStatus: child.status,
    elapsedMs: Date.now() - startedAt,
    workDir: summary.workDir,
    summarySource: checkedSummary ? "cache" : "run",
    checkedSummary,
    savedSummaryPath,
    refusalCode: refusalCode(summary),
    targetGates: targetGates(summary),
    remoteHostDetails: summary.proofProvenance?.remote ?? {},
    runnerSummary: summary,
  };
}

function refusalCode(summary) {
  return (
    summary.smokeSummary?.targetRestore?.refusal?.code ??
    summary.gateCheck?.checks?.find((check) => check.label === "refusal.code")?.actual
  );
}

function targetGates(summary) {
  const target = summary.smokeSummary?.targetRestore ?? {};
  return {
    migrationCompleted: target.migrationCompleted,
    descriptorGateCompleted: target.descriptorGateCompleted,
    targetVerifierResult: target.targetVerifierResult,
    targetStateConsumptionResult: target.targetStateConsumptionResult,
    targetResumePathResult: target.targetResumePathResult,
  };
}

function artifactInventory(results) {
  return {
    kind: "machinen.portable-machine-proof-artifact-inventory",
    profiles: Object.fromEntries(
      results.map((result) => [result.profile, artifactEntries(result.runnerSummary, result)]),
    ),
  };
}

function artifactEntries(summary, result) {
  return [...localArtifactEntries(summary, result), ...provenanceArtifactEntries(summary)].filter(
    (entry) => entry.path || entry.remotePath,
  );
}

function localArtifactEntries(summary, result) {
  const logs = summary.logs ?? {};
  const smoke = summary.smokeSummary ?? {};
  return [
    { kind: "work-dir", path: result.workDir },
    { kind: "checked-summary", path: result.checkedSummary },
    { kind: "saved-summary", path: result.savedSummaryPath },
    ...Object.entries(logs).map(([kind, path]) => ({ kind: `log:${kind}`, path })),
    { kind: "native-process-bundle", path: smoke.nativeProcessBundle },
    { kind: "portable-machine-bundle", path: smoke.portableMachineBundle },
    { kind: "target-code-file", path: smoke.targetCodeFile },
    { kind: "remote-portable-machine-bundle", remotePath: smoke.remotePortableMachineBundle },
    { kind: "remote-target-code-file", remotePath: smoke.remoteTargetCodeFile },
  ];
}

function provenanceArtifactEntries(summary) {
  const artifacts = summary.proofProvenance?.artifacts ?? {};
  return Object.entries(artifacts).map(([kind, artifact]) => ({
    kind: `provenance:${kind}`,
    path: artifact.path,
    exists: artifact.exists,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
    file: artifact.file,
  }));
}

function profileCounts(profiles) {
  return profiles.reduce(
    (acc, profile) => {
      acc.total += 1;
      acc.bySupportStatus[profile.supportStatus] =
        (acc.bySupportStatus[profile.supportStatus] ?? 0) + 1;
      acc.byExpectedResult[profile.expectedResult] =
        (acc.byExpectedResult[profile.expectedResult] ?? 0) + 1;
      return acc;
    },
    { total: 0, bySupportStatus: {}, byExpectedResult: {} },
  );
}

// fallow-ignore-next-line complexity
function matrixSummary(options, profiles, results, startedAt, schemaValidation, unshardedCount) {
  const failed = results.filter((result) => !result.pass);
  return {
    kind: "machinen.portable-machine-proof-matrix",
    state: failed.length === 0 ? "completed" : "failed",
    pass: failed.length === 0,
    profileCounts: profileCounts(profiles),
    selectedProfiles: profiles.map((profile) => profile.name),
    shard: options.shard
      ? {
          ...options.shard,
          selectedBeforeShard: unshardedCount,
          selectedAfterShard: profiles.length,
        }
      : undefined,
    schemaValidation,
    timings: [
      {
        name: "portable-machine-proof-matrix",
        status: failed.length === 0 ? "ok" : "failed",
        ms: Date.now() - startedAt,
      },
      ...results.map((result) => ({
        name: result.profile,
        status: result.pass ? "ok" : "failed",
        ms: result.elapsedMs,
      })),
    ],
    workdirs: Object.fromEntries(
      results.map((result) => [result.profile, result.workDir]).filter((entry) => entry[1]),
    ),
    refusalCodes: Object.fromEntries(
      results.map((result) => [result.profile, result.refusalCode]).filter((entry) => entry[1]),
    ),
    targetGates: Object.fromEntries(results.map((result) => [result.profile, result.targetGates])),
    summarySources: Object.fromEntries(
      results.map((result) => [result.profile, result.summarySource]),
    ),
    savedSummaries: Object.fromEntries(
      results
        .map((result) => [result.profile, result.savedSummaryPath])
        .filter((entry) => entry[1]),
    ),
    artifactInventory: artifactInventory(results),
    remoteHostDetails:
      results.find((result) => Object.keys(result.remoteHostDetails).length > 0)
        ?.remoteHostDetails ?? {},
    results,
  };
}

// fallow-ignore-next-line complexity
function main() {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  const allProfiles = loadProfiles();
  const schemaValidation = validatePortableMachineProofProfiles(allProfiles);
  if (!schemaValidation.passed) {
    const summary = matrixSummary(options, [], [], startedAt, schemaValidation, 0);
    output(summary, options);
    process.exit(1);
  }
  const unsharded = selectProfiles(allProfiles, options);
  const selected = applyShard(unsharded, options.shard);
  const results = [];
  for (const [index, profile] of selected.entries()) {
    const result = runOne(profile, options, index);
    results.push(result);
    if (!result.pass && !options.continueOnFail) {
      break;
    }
  }
  const summary = matrixSummary(
    options,
    selected,
    results,
    startedAt,
    schemaValidation,
    unsharded.length,
  );
  output(summary, options);
  process.exit(summary.pass ? 0 : 1);
}

function output(summary, options) {
  writeJsonFileOption(options.summary, summary);
  writeJsonFileOption(options.artifactInventory, summary.artifactInventory);
  if (shouldPrintSummary(options)) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  }
}

function writeJsonFileOption(path, value) {
  if (!path) {
    return;
  }
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`);
}

function shouldPrintSummary(options) {
  return options.json || !options.summary;
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
