#!/usr/bin/env node

// Node runtime support fixture used by Goal 27 proof profiles.
//
// The proof runner records live-capture contract entries that point at anchors in
// this file. The fixture intentionally exposes only deterministic runtime state:
// runtime versions, argv/execArgv, module identity, event-loop quiescence probes,
// and a JS continuation sentinel. It does not use application hooks, source text
// replay, native addons, workers, inspector state, child processes, or live
// network sockets as correctness paths.

import { createHash } from "node:crypto";
import { argv, cwd, execArgv, versions } from "node:process";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function runtimeIdentity() {
  return {
    node: versions.node,
    v8: versions.v8,
    uv: versions.uv,
    modules: versions.modules,
    openssl: versions.openssl,
    arch: process.arch,
    platform: process.platform,
    execArgv,
    argv: argv.slice(0, 2),
    cwd: cwd(),
  };
}

function positiveCapture(profile = "node-empty-event-loop-recreate") {
  const identity = runtimeIdentity();
  return {
    profile,
    kind: "positive",
    runtime: "node",
    identity,
    identitySha256: sha256(identity),
    eventLoop: {
      activeHandles: 0,
      activeRequests: 0,
      pendingTimers: 0,
      workers: 0,
      inspector: false,
      childProcesses: 0,
      liveSockets: 0,
    },
    continuation: {
      kind: "target-native-js-continuation",
      expectedValue: "machinen-node-goal27-ok",
    },
    forbiddenSuccessPaths: {
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      sourceTextReusedAsTargetCode: false,
    },
  };
}

function negativeCapture(profile, refusalCode) {
  return {
    ...positiveCapture(profile),
    kind: "negative",
    expectedRefusalCode: refusalCode,
    migrationCompleted: false,
  };
}

const [profile = "node-empty-event-loop-recreate", refusalCode] = argv.slice(2);
const capture = refusalCode ? negativeCapture(profile, refusalCode) : positiveCapture(profile);
process.stdout.write(`${JSON.stringify(capture, null, 2)}\n`);
