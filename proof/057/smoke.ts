#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type Result = {
  accepted: boolean;
  structuredJsonParsed: boolean;
  targetStarted: boolean;
  refusal?: { code: string };
  count?: number;
  graphTotal?: number;
};
function bundle(): Record<string, unknown> {
  return {
    schemaVersion: 1,
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
    appExportImportUsed: false,
  };
}
function verify(work: string, id: string, value: unknown): Result {
  const bundlePath = join(work, `${id}.json`);
  const resultPath = join(work, `${id}-result.json`);
  writeFileSync(
    bundlePath,
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
  );
  const run = spawnSync(
    "zig",
    ["run", join(proofDir, "native-json-verifier.zig"), "--", bundlePath, resultPath],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (!existsSync(resultPath)) {
    throw new Error(`no verifier result for ${id}: ${run.stderr}`);
  }
  return JSON.parse(readFileSync(resultPath, "utf8")) as Result;
}
function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-057."));
  const accepted = verify(work, "valid", bundle());
  if (
    !accepted.accepted ||
    !accepted.structuredJsonParsed ||
    accepted.targetStarted ||
    accepted.count !== 2
  ) {
    throw new Error(`valid refused: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, unknown, string]> = [
    ["invalid-json", "{", "node-proper-level5-structured-json-schema-refused"],
    [
      "schema-version",
      { ...bundle(), schemaVersion: 2 },
      "node-proper-level5-structured-json-schema-version-refused",
    ],
    [
      "architecture",
      { ...bundle(), architecture: { source: "amd64", target: "amd64" } },
      "node-proper-level5-structured-json-architecture-refused",
    ],
    [
      "continuation",
      { ...bundle(), continuationDescriptor: { continuationClass: "unknown" } },
      "node-proper-level5-structured-json-continuation-refused",
    ],
    [
      "digest",
      { ...bundle(), bundleDigestOk: false },
      "node-proper-level5-structured-json-digest-refused",
    ],
    [
      "product",
      { ...bundle(), productSupportClaimed: true },
      "node-proper-level5-structured-json-product-claim-refused",
    ],
    [
      "shortcut",
      { ...bundle(), sourceIsaEmulationUsed: true },
      "node-proper-level5-structured-json-shortcut-refused",
    ],
  ];
  const refusedRows = cases.map(([id, value, expectedCode]) => {
    const result = verify(work, id, value);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-structured-json-verifier-summary",
    proof: "057",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      nativeVerifierParsesStructuredJson: true,
      invalidBundlesRefuseBeforeTargetStart: true,
      noStringSearchVerifierClaim: true,
      noProductSupportClaimed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_057_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/057/checked-summary.json is stale; rerun with UPDATE_PROOF_057_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: accepted.accepted, refused: refusedRows.length }));
  console.log("proof 057 structured native JSON verifier passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
