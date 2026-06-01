#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type VerifyResult = { accepted: boolean; targetStarted: boolean; refusal?: { code: string } };

function baseBundle(): Record<string, unknown> {
  return {
    kind: "machinen.node-proper-level5-translated-continuation-bundle",
    schemaVersion: 1,
    proof: "048",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    architecture: { source: "arm64", target: "amd64" },
    heapGraphIr: { count: 2, graphTotal: 2 },
    continuationDescriptor: { continuationClass: "node-libuv-event-loop-wait-v1" },
    resourceDescriptors: [{ kind: "tcp-listener-v1" }, { kind: "repeating-timer-v1" }],
    refusalPolicy: { refusedRows: ["active-request"] },
    canonicalSectionDigestsOk: true,
    bundleDigestOk: true,
    runtimeProfileRouteUsed: false,
    rawSourceRegistersCopiedToTarget: false,
    rawSourcePcCopiedToTarget: false,
    rawSourceStackCopiedToTarget: false,
    sourceKernelFdReusedOnTarget: false,
    sourceIsaEmulationUsed: false,
    sidecarReplayUsed: false,
    metadataOnlySuccess: false,
  };
}

function verify(work: string, id: string, bundle: Record<string, unknown>): VerifyResult {
  const bundlePath = join(work, `${id}.json`);
  const resultPath = join(work, `${id}-result.json`);
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  const result = spawnSync(
    "zig",
    ["run", join(proofDir, "native-bundle-verifier.zig"), "--", bundlePath, resultPath],
    {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (!existsSync(resultPath)) {
    throw new Error(`verifier wrote no result for ${id}: ${result.stderr}`);
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as VerifyResult;
}

function assertRefusal(
  row: { id: string; result: VerifyResult },
  expectedCode: string,
): Record<string, unknown> {
  if (
    row.result.accepted ||
    row.result.refusal?.code !== expectedCode ||
    row.result.targetStarted
  ) {
    throw new Error(`${row.id} expected ${expectedCode}, got ${JSON.stringify(row.result)}`);
  }
  return {
    id: row.id,
    expectedCode,
    actualCode: row.result.refusal.code,
    targetStarted: row.result.targetStarted,
  };
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-048."));
  const accepted = verify(work, "valid", baseBundle());
  if (!accepted.accepted || accepted.targetStarted) {
    throw new Error(`valid bundle refused: ${JSON.stringify(accepted)}`);
  }
  const rows = [
    assertRefusal(
      { id: "schema", result: verify(work, "schema", { ...baseBundle(), schemaVersion: 2 }) },
      "node-proper-level5-native-hardening-schema-version-missing",
    ),
    assertRefusal(
      { id: "digest", result: verify(work, "digest", { ...baseBundle(), bundleDigestOk: false }) },
      "node-proper-level5-native-hardening-digest-refused",
    ),
    assertRefusal(
      {
        id: "architecture",
        result: verify(work, "architecture", {
          ...baseBundle(),
          architecture: { source: "amd64", target: "amd64" },
        }),
      },
      "node-proper-level5-native-hardening-architecture-refused",
    ),
    assertRefusal(
      {
        id: "product-claim",
        result: verify(work, "product-claim", { ...baseBundle(), productSupportClaimed: true }),
      },
      "node-proper-level5-native-hardening-product-claim-refused",
    ),
    assertRefusal(
      {
        id: "shortcut",
        result: verify(work, "shortcut", { ...baseBundle(), sourceIsaEmulationUsed: true }),
      },
      "node-proper-level5-native-hardening-shortcut-refused",
    ),
  ];
  const checkedSummary = {
    kind: "machinen.node-proper-level5-native-verifier-hardening-summary",
    proof: "048",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows: rows,
    assertions: {
      nativeVerifierRanBeforeTarget: accepted.accepted && !accepted.targetStarted,
      schemaDigestArchitectureAndShortcutChecksNative: true,
      refusedBundlesNeverStartedTarget: rows.every((row) => row.targetStarted === false),
      noProductSupportClaimed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_048_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/048/checked-summary.json is stale; rerun with UPDATE_PROOF_048_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: accepted.accepted, refused: rows.length }));
  console.log("node proper Level 5 native verifier hardening proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
