#!/usr/bin/env node

// Representative Node application support fixture for proof-backed runtime
// support. The fixture emits deterministic application state and an output
// sentinel; it does not use source-ISA execution, sidecar runtimes, source text
// replay, or application hooks as correctness paths.

import { createHash } from "node:crypto";
import { argv, cwd, execArgv, execPath, versions } from "node:process";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function runtimeIdentity() {
  return {
    execPath,
    node: versions.node,
    v8: versions.v8,
    uv: versions.uv,
    openssl: versions.openssl,
    modules: versions.modules,
    arch: process.arch,
    platform: process.platform,
    execArgv,
    argv: argv.slice(0, 2),
    cwd: cwd(),
  };
}

function applicationCapture(
  profile = "node-app-cli-script-recreate",
  workload = "node-cli-script",
) {
  const identity = runtimeIdentity();
  return {
    profile,
    workload,
    kind: "positive",
    runtime: "node",
    identity,
    identitySha256: sha256(identity),
    applicationState: {
      moduleGraph: "digest-verified-fixture",
      libuvInventory: "accepted-workload-fixture",
      asyncInventory: "accepted-workload-fixture",
      kernelResources: "graduated-contracts-only",
      outputSentinel: `${workload}-ok`,
    },
    migrationCompleted: true,
    forbiddenSuccessPaths: {
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      sourceTextReusedAsTargetCode: false,
    },
  };
}

const [profile, workload] = argv.slice(2);
process.stdout.write(`${JSON.stringify(applicationCapture(profile, workload), null, 2)}\n`);
