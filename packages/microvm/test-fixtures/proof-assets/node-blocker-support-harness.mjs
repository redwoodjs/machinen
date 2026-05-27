#!/usr/bin/env node

// Goal 29 Node blocker fixture.
//
// This deterministic fixture models the source-capture observations used by the
// Node blocker proof profiles. Positive profiles expose bounded target-native
// Node/V8/libuv state for a solved blocker subset. Negative profiles expose the
// broad unsupported neighbor that must fail closed before migration completion.

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

function baseCapture(profile, family, item) {
  const identity = runtimeIdentity();
  return {
    profile,
    runtime: "node",
    family,
    item,
    identity,
    identitySha256: sha256(identity),
    verifierInputs: {
      moduleGraph: "digest-verified-fixture",
      libuvInventory: "bounded-fixture",
      asyncInventory: "bounded-fixture",
      kernelResources: "graduated-contracts-only",
      continuation: "machinen-node-goal29-ok",
    },
    forbiddenSuccessPaths: {
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      sourceTextReusedAsTargetCode: false,
    },
  };
}

function positiveCapture(profile, family, item) {
  return {
    ...baseCapture(profile, family, item),
    kind: "positive",
    acceptedSubset: `node-blocker-${family}-${item}-v1-target-native`,
    migrationCompleted: true,
  };
}

function negativeCapture(profile, family, item, refusalCode) {
  return {
    ...baseCapture(profile, family, item),
    kind: "negative",
    expectedRefusalCode: refusalCode,
    migrationCompleted: false,
  };
}

const [profile = "node-blocker-fixture", family = "generic", item = "fixture", refusalCode] =
  argv.slice(2);
const capture = refusalCode
  ? negativeCapture(profile, family, item, refusalCode)
  : positiveCapture(profile, family, item);
process.stdout.write(`${JSON.stringify(capture, null, 2)}\n`);
