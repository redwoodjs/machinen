#!/usr/bin/env node

// Goal 28 invalidation fixture.
//
// This deterministic fixture models the source-capture observations used by the
// portable invalidation proof profiles. Positive profiles emit matching identity
// and artifact fields; negative profiles name the drifted field and stable
// refusal code that must fail closed before migration completion.

import { createHash } from "node:crypto";
import { argv, cwd, execPath, versions } from "node:process";

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function baselineIdentity() {
  return {
    runtime: {
      execPath,
      node: versions.node,
      v8: versions.v8,
      uv: versions.uv,
      openssl: versions.openssl,
      modules: versions.modules,
      arch: process.arch,
      platform: process.platform,
    },
    processContext: {
      argv: argv.slice(0, 2),
      cwd: cwd(),
      envAllowlist: Object.fromEntries(
        Object.entries(process.env)
          .filter(([key]) => key.startsWith("MACHINEN_"))
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
    artifacts: {
      restoreDescriptor: "matching-restore-descriptor",
      portableSnapshot: "matching-portable-snapshot",
      targetContinuation: "matching-target-continuation",
      targetRestoreSummary: "matching-target-restore-summary",
      sourceCapture: "matching-source-capture",
    },
  };
}

function positiveCapture(profile = "invalidation-valid-baseline") {
  const identity = baselineIdentity();
  return {
    profile,
    kind: "positive",
    identity,
    identitySha256: sha256(identity),
    invalidation: {
      driftedField: null,
      identitiesMatch: true,
      migrationCompleted: true,
    },
    forbiddenSuccessPaths: {
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      sourceTextReusedAsTargetCode: false,
    },
  };
}

function negativeCapture(profile, refusalCode, driftedField = "unspecified") {
  const capture = positiveCapture(profile);
  return {
    ...capture,
    kind: "negative",
    expectedRefusalCode: refusalCode,
    invalidation: {
      driftedField,
      identitiesMatch: false,
      migrationCompleted: false,
    },
  };
}

const [profile = "invalidation-valid-baseline", refusalCode, driftedField] = argv.slice(2);
const capture = refusalCode
  ? negativeCapture(profile, refusalCode, driftedField)
  : positiveCapture(profile);
process.stdout.write(`${JSON.stringify(capture, null, 2)}\n`);
