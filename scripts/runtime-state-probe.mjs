#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RUNTIME_STATE_WORKLOAD_MARKER } from "../packages/microvm/test-fixtures/proof-assets/runtime-state-workload.mjs";
import {
  REPO_ROOT,
  bundleFileStats as sharedBundleFileStats,
  hostArch,
  jsonDocument,
  readJson,
  unsupportedVocabulary,
} from "./controlled-corpus-utils.mjs";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
  runCommand,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: node scripts/runtime-state-probe.mjs [verify] [--out-dir path] [--json] [--keep]";
const WORKLOAD = join(
  REPO_ROOT,
  "packages/microvm/test-fixtures/proof-assets/runtime-state-workload.mjs",
);
const BUILD_ID = "4214214214214210";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-runtime-state-probe-");
  try {
    emitResult(verifyRuntimeStateProbe(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyRuntimeStateProbe(outDir) {
  assert(existsSync(WORKLOAD), `missing runtime workload: ${WORKLOAD}`);
  mkdirSync(outDir, { recursive: true });
  const node = runRuntimeProbe({ runtime: "node", command: process.execPath, outDir });
  const bunCommand = findCommand("bun");
  const bun = bunCommand
    ? runRuntimeProbe({ runtime: "bun", command: bunCommand, outDir })
    : unavailableRuntime("bun");
  const summary = {
    formatVersion: 1,
    hostArch: hostArch(),
    node,
    bun,
    plan: planFromEvidence({ node, bun }),
  };
  validateSummary(summary);
  return summary;
}

function runRuntimeProbe({ runtime, command, outDir }) {
  const runtimeDir = join(outDir, runtime);
  const captureDir = join(runtimeDir, "capture");
  const bundleDir = join(runtimeDir, "bundle");
  mkdirSync(captureDir, { recursive: true });
  const captureResult = runCommand(
    command,
    [WORKLOAD, "capture", "--out", captureDir, "--runtime", runtime],
    { label: `${runtime} runtime capture`, env: { ...process.env, MACHINEN_RUNTIME_PROBE: "1" } },
  );
  const captureEvent = parseRuntimeMarker(captureResult.stdout, "capture");
  const runtimeState = readJson(join(captureDir, "runtime-state.json"));
  writeBundle({ runtime, command, captureDir, bundleDir, runtimeState });
  const restoreResult = runCommand(
    command,
    [WORKLOAD, "restore", "--bundle", bundleDir, "--runtime", runtime],
    { label: `${runtime} runtime restore`, env: { ...process.env, MACHINEN_RUNTIME_PROBE: "1" } },
  );
  const restoreEvent = parseRuntimeMarker(restoreResult.stdout, "restore");
  return {
    runtime,
    available: true,
    command,
    captureDir,
    bundleDir,
    captureEvent,
    restoreEvent,
    semanticState: summarizeSemanticState(runtimeState.semanticState),
    serializerEvidence: runtimeState.serializerEvidence,
    conclusion: runtimeState.conclusion,
    bundleFiles: bundleFileStats(bundleDir, runtime),
  };
}

function writeBundle({ runtime, command, captureDir, bundleDir, runtimeState }) {
  mkdirSync(bundleDir, { recursive: true });
  mkdirSync(join(bundleDir, "logs"), { recursive: true });
  writeFileSync(join(bundleDir, "memory.bin"), Buffer.alloc(0));
  writeFileSync(
    join(bundleDir, "manifest.json"),
    jsonDocument(manifest(runtime, command, runtimeState)),
  );
  writeFileSync(join(bundleDir, "objects.json"), jsonDocument(objects(runtimeState)));
  writeFileSync(join(bundleDir, "relocations.json"), jsonDocument(relocations()));
  writeFileSync(
    join(bundleDir, "resources.json"),
    jsonDocument(resources(runtime, command, runtimeState)),
  );
  writeFileSync(join(bundleDir, "runtime-state.json"), jsonDocument(runtimeState));
  copyFileSync(join(captureDir, "target.log"), join(bundleDir, "logs/source-target.log"));
  const v8Payload = join(captureDir, "node-v8-state.bin");
  if (existsSync(v8Payload)) {
    copyFileSync(v8Payload, join(bundleDir, "node-v8-state.bin"));
  }
}

function manifest(runtime, command, runtimeState) {
  return {
    formatVersion: 1,
    sourceGuestArch: runtimeState.sourceGuestArch,
    allowedTargetGuestArchs: ["arm64", "amd64"],
    program: {
      name: `${runtime}-runtime-state-probe`,
      executable: command,
      identity: `com.redwoodjs.machinen.${runtime}-runtime-state-probe`,
    },
    sourceBuild: { buildId: BUILD_ID, version: runtimeState.runtime.version },
    targetBuild: { version: runtimeState.runtime.version },
    checkpointAbi: {
      version: 1,
      checkpointFunction: { name: "machinen_checkpoint" },
      rootsType: "machinen_checkpoint_roots",
      restoreBundleType: "machinen_restore_bundle",
      safePoint: { outsideSignalHandlers: true, outsideSyscalls: true },
    },
    checkpointContinuation: { name: `${runtime}_runtime_semantic_state` },
    restoreEntrypoint: { name: `${runtime}_runtime_restore_adapter` },
    process: {
      argv: [command, WORKLOAD, "restore", "--bundle", "<bundle>", "--runtime", runtime],
      env: { MACHINEN_RUNTIME_PROBE: "1" },
      cwd: process.cwd(),
    },
    features: ["runtime-state-probe", `${runtime}-semantic-state`, "js-object-identity"],
    unsupported: unsupportedVocabulary(),
  };
}

function objects(runtimeState) {
  return {
    formatVersion: 1,
    objects: [
      {
        id: "js-root-state",
        kind: "opaque",
        type: "JavaScript semantic roots",
        sizeBytes: 0,
      },
      {
        id: "js-object-graph",
        kind: "opaque",
        type: "JavaScript object graph sidecar",
        sizeBytes: runtimeState.semanticState.objects.length,
      },
      {
        id: "js-runtime-handles",
        kind: "opaque",
        type: "Runtime native handles refused by probe",
        sizeBytes: runtimeState.semanticState.nativeHandles.length,
      },
    ],
    unsupported: unsupportedVocabulary(),
  };
}

function relocations() {
  return { formatVersion: 1, relocations: [], unsupported: unsupportedVocabulary() };
}

function resources(runtime, command, runtimeState) {
  return {
    formatVersion: 1,
    resources: [
      {
        id: "argv",
        kind: "argv",
        state: "captured",
        argv: [command, WORKLOAD, "restore", "--runtime", runtime],
      },
      { id: "env", kind: "env", state: "captured", env: { MACHINEN_RUNTIME_PROBE: "1" } },
      { id: "cwd", kind: "cwd", state: "captured", path: process.cwd() },
      ...runtimeState.semanticState.nativeHandles.map((handle) => ({
        id: handle.id,
        kind: handle.kind,
        state: handle.state,
        fd: handle.kind === "fd" ? 1 : undefined,
        refusal: handle.refusal,
      })),
    ],
    unsupported: unsupportedVocabulary(),
  };
}

function summarizeSemanticState(semanticState) {
  return {
    runtime: semanticState.runtime,
    counter: semanticState.roots.counter,
    values: semanticState.roots.values,
    checksumHex: semanticState.checksumHex,
    objectCount: semanticState.objects.length,
    identityAssertions: semanticState.identityAssertions,
    nativeHandleRefusals: semanticState.nativeHandles.map((handle) => handle.refusal.code),
  };
}

function unavailableRuntime(runtime) {
  return {
    runtime,
    available: false,
    refusal: {
      code: "runtime-adapter-missing",
      message: `${runtime} executable is not available; install the runtime or provide a runtime adapter sidecar`,
      detail: {
        command: runtime,
        requirement: "semantic object graph capture plus native handle refusal reporting",
      },
    },
    conclusion: `${runtime} still needs a runtime adapter or sidecar before portable restore can be proven here.`,
  };
}

function findCommand(command) {
  try {
    runCommand(command, ["--version"], { label: `${command} availability` });
    return command;
  } catch {
    return null;
  }
}

function validateSummary(summary) {
  validateRuntime(summary.node);
  if (summary.bun.available) {
    validateRuntime(summary.bun);
  } else {
    assert(
      summary.bun.refusal.code === "runtime-adapter-missing",
      "Bun absence should produce a stable refusal",
    );
  }
}

function validateRuntime(result) {
  assert(result.available, `${result.runtime} runtime was not available`);
  assert(
    result.captureEvent.identity_preserved === true,
    `${result.runtime}: capture lost identity`,
  );
  assert(
    result.restoreEvent.identity_preserved === true,
    `${result.runtime}: restore lost identity`,
  );
  assert(
    result.restoreEvent.references_restored === true,
    `${result.runtime}: restore lost references`,
  );
  assert(result.semanticState.counter === 4210, `${result.runtime}: counter changed`);
  assert(
    result.semanticState.checksumHex === result.restoreEvent.checksum_hex,
    `${result.runtime}: checksum changed`,
  );
  assert(
    result.semanticState.nativeHandleRefusals.includes("fd-kind-unsupported"),
    `${result.runtime}: missing fd refusal`,
  );
  assert(
    result.semanticState.nativeHandleRefusals.includes("runtime-heap-unsupported"),
    `${result.runtime}: missing runtime handle refusal`,
  );
}

function planFromEvidence({ node, bun }) {
  return {
    claudeCodeTarget:
      "needs a runtime adapter plus sidecar graph metadata; raw JS heap bytes are not a portable contract",
    piTarget:
      "can start with semantic JS roots and explicit native-handle refusals before attempting full process restore",
    node: node.available
      ? "semantic graph restore works; v8.serialize is useful only with runtime-version checks"
      : node.refusal.message,
    bun: bun.available
      ? "semantic graph restore works when Bun is installed; native handles still need an adapter"
      : bun.refusal.message,
  };
}

function parseRuntimeMarker(stdout, expectedMode) {
  const line = stdout
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(RUNTIME_STATE_WORKLOAD_MARKER));
  if (!line) {
    throw new Error("missing runtime state marker");
  }
  const event = JSON.parse(line.slice(RUNTIME_STATE_WORKLOAD_MARKER.length));
  if (event.mode !== expectedMode) {
    throw new Error(`unexpected runtime marker mode: ${event.mode}`);
  }
  return event;
}

function bundleFileStats(bundleDir, runtime) {
  const names = [
    "manifest.json",
    "objects.json",
    "relocations.json",
    "resources.json",
    "runtime-state.json",
    "memory.bin",
  ];
  if (runtime === "node" && existsSync(join(bundleDir, "node-v8-state.bin"))) {
    names.push("node-v8-state.bin");
  }
  return sharedBundleFileStats(bundleDir, names);
}

function printSummary(summary, temporary) {
  console.log(
    `runtime-state-probe: node restored counter=${summary.node.semanticState.counter} identity=${summary.node.restoreEvent.identity_preserved}`,
  );
  if (summary.bun.available) {
    console.log(
      `runtime-state-probe: bun restored counter=${summary.bun.semanticState.counter} identity=${summary.bun.restoreEvent.identity_preserved}`,
    );
  } else {
    console.log(`runtime-state-probe: bun refused (${summary.bun.refusal.code})`);
  }
  if (temporary) {
    console.log("runtime-state-probe: temporary artifacts removed; pass --keep to inspect them");
  }
}

main();
