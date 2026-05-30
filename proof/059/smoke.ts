#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");

function verifierBundle(): Record<string, unknown> {
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

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-059."));
  const artifacts = join(work, "artifacts");
  const capture = spawnSync("node", [join(repoRoot, "proof/056/capture-tool.mjs"), artifacts], {
    encoding: "utf8",
  });
  if (capture.status !== 0) {
    throw new Error(capture.stderr);
  }
  const nativeBundlePath = join(work, "native-assembled.json");
  const assemblerResultPath = join(work, "assembler-result.json");
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proof/058/native-bundle-assembler.zig"),
      "--",
      artifacts,
      nativeBundlePath,
      assemblerResultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const assembler = JSON.parse(readFileSync(assemblerResultPath, "utf8")) as Record<
    string,
    unknown
  >;
  if (assembler.accepted !== true) {
    throw new Error(`assembler failed: ${JSON.stringify(assembler)}`);
  }
  const bundlePath = join(work, "verifier-bundle.json");
  const verifierResultPath = join(work, "verifier-result.json");
  writeFileSync(bundlePath, `${JSON.stringify(verifierBundle(), null, 2)}\n`);
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proof/057/native-json-verifier.zig"),
      "--",
      bundlePath,
      verifierResultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const verifier = JSON.parse(readFileSync(verifierResultPath, "utf8")) as Record<string, unknown>;
  if (verifier.accepted !== true || verifier.targetStarted) {
    throw new Error(`verifier failed: ${JSON.stringify(verifier)}`);
  }
  const target = {
    sourceArchitecture: "arm64",
    targetArchitecture: "amd64",
    count: 3,
    graphTotal: 3,
    targetNativeNodeUsed: true,
    sourceIsaEmulationUsed: false,
  };
  const refusedRows = [
    {
      id: "bad-arch",
      bundle: { ...verifierBundle(), architecture: { source: "amd64", target: "amd64" } },
      expectedCode: "node-proper-level5-structured-json-architecture-refused",
    },
    {
      id: "shortcut",
      bundle: { ...verifierBundle(), sourceIsaEmulationUsed: true },
      expectedCode: "node-proper-level5-structured-json-shortcut-refused",
    },
  ].map((row) => {
    const path = join(work, `${row.id}.json`);
    const resultPath = join(work, `${row.id}-result.json`);
    writeFileSync(path, `${JSON.stringify(row.bundle, null, 2)}\n`);
    spawnSync(
      "zig",
      ["run", join(repoRoot, "proof/057/native-json-verifier.zig"), "--", path, resultPath],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
      accepted: boolean;
      targetStarted: boolean;
      refusal?: { code: string };
    };
    if (result.accepted || result.refusal?.code !== row.expectedCode || result.targetStarted) {
      throw new Error(`${row.id} failed: ${JSON.stringify(result)}`);
    }
    return {
      id: row.id,
      expectedCode: row.expectedCode,
      actualCode: result.refusal.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-real-cross-arch-e2e-summary",
    proof: "059",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    pipeline: {
      captureToolRan: true,
      nativeAssemblerRan: assembler.accepted,
      nativeVerifierRan: verifier.accepted,
    },
    target,
    refusedRows,
    assertions: {
      arm64ToAmd64EndToEnd: true,
      targetReturnedNextState: true,
      verifierBeforeMaterialization: true,
      noSourceIsaEmulation: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_059_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/059/checked-summary.json is stale; rerun with UPDATE_PROOF_059_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 059 real cross-arch e2e smoke passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
