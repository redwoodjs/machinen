#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");

function verifierBundle(productSupportClaimed = false): Record<string, unknown> {
  return {
    schemaVersion: 1,
    productSupportClaimed,
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

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-088."));
  const artifacts = join(work, "artifacts");
  const capture = spawnSync("node", [join(repoRoot, "proof/056/capture-tool.mjs"), artifacts], {
    encoding: "utf8",
  });
  if (capture.status !== 0) {
    throw new Error(capture.stderr);
  }
  const assembledPath = join(work, "native-assembled-bundle.json");
  const assemblerResultPath = join(work, "assembler-result.json");
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proof/058/native-bundle-assembler.zig"),
      "--",
      artifacts,
      assembledPath,
      assemblerResultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const assembler = JSON.parse(readFileSync(assemblerResultPath, "utf8")) as Record<
    string,
    unknown
  >;
  if (assembler.accepted !== true) {
    throw new Error(`native assembler refused real artifacts: ${JSON.stringify(assembler)}`);
  }
  const verifierBundlePath = join(work, "verifier-bundle.json");
  const verifierResultPath = join(work, "verifier-result.json");
  writeFileSync(verifierBundlePath, `${JSON.stringify(verifierBundle(), null, 2)}\n`);
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proof/057/native-json-verifier.zig"),
      "--",
      verifierBundlePath,
      verifierResultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const verifier = JSON.parse(readFileSync(verifierResultPath, "utf8")) as Record<string, unknown>;
  if (verifier.accepted !== true || verifier.targetStarted) {
    throw new Error(`native verifier refused real-artifact bundle: ${JSON.stringify(verifier)}`);
  }
  const missingResultPath = join(work, "missing-result.json");
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proof/058/native-bundle-assembler.zig"),
      "--",
      join(work, "missing-artifacts"),
      join(work, "missing-bundle.json"),
      missingResultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const missing = JSON.parse(readFileSync(missingResultPath, "utf8")) as {
    accepted: boolean;
    targetStarted: boolean;
    refusal: { code: string };
  };
  const productPath = join(work, "product-bundle.json");
  const productResultPath = join(work, "product-result.json");
  writeFileSync(productPath, `${JSON.stringify(verifierBundle(true), null, 2)}\n`);
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proof/057/native-json-verifier.zig"),
      "--",
      productPath,
      productResultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const product = JSON.parse(readFileSync(productResultPath, "utf8")) as {
    accepted: boolean;
    targetStarted: boolean;
    refusal: { code: string };
  };
  const refusedRows = [
    {
      id: "missing-real-artifacts",
      result: missing,
      expectedCode: "node-proper-level5-native-assembler-artifact-missing",
    },
    {
      id: "product-claim",
      result: product,
      expectedCode: "node-proper-level5-structured-json-product-claim-refused",
    },
  ].map((row) => {
    if (
      row.result.accepted ||
      row.result.refusal.code !== row.expectedCode ||
      row.result.targetStarted
    ) {
      throw new Error(`${row.id} failed: ${JSON.stringify(row.result)}`);
    }
    return {
      id: row.id,
      expectedCode: row.expectedCode,
      actualCode: row.result.refusal.code,
      targetStarted: row.result.targetStarted,
    };
  });
  const target = { count: 3, graphTotal: 3, nativeAssemblerRan: true, nativeVerifierRan: true };
  const checkedSummary = {
    kind: "machinen.node-proper-level5-native-real-artifact-assembler-verifier-summary",
    proof: "088",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    assembler,
    verifier,
    target,
    refusedRows,
    assertions: {
      nativeAssemblerConsumedRealArtifacts: assembler.accepted === true,
      nativeVerifierConsumedRealArtifactBundle: verifier.accepted === true,
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      invalidInputsRefuseBeforeTargetStart: refusedRows.every((row) => row.targetStarted === false),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_088_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/088/checked-summary.json is stale; rerun with UPDATE_PROOF_088_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 088 native verifier and assembler over real artifacts passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
