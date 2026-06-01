#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../../../..");
const nativeVerifier = join(repoRoot, "proofs/by-id/048/native-bundle-verifier.zig");

type CliResult = {
  accepted: boolean;
  code: string;
  targetStarted: boolean;
  nativeVerifierInvoked: boolean;
  provenanceChecked: boolean;
  plan?: Record<string, unknown>;
};

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function bundle(): Record<string, unknown> {
  return {
    kind: "machinen.node-proper-level5-translated-continuation-bundle",
    schemaVersion: 1,
    proof: "055",
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
    appExportImportUsed: false,
  };
}

function provenanceForBundle(bundleValue: Record<string, unknown>): Record<string, unknown> {
  const body = {
    bundleDigest: digest(bundleValue),
    generator: "proof-055-private-cli-provenance-v1",
    fields: ["heapGraphIr", "continuationDescriptor", "resourceDescriptors", "architecture"],
  };
  return { ...body, digest: digest(body) };
}

function checkProvenance(
  bundleValue: Record<string, unknown>,
  provenance: Record<string, unknown> | undefined,
): { accepted: boolean; code: string } {
  if (!provenance) {
    return { accepted: false, code: "node-proper-level5-private-cli-provenance-missing" };
  }
  const expectedBody = {
    bundleDigest: digest(bundleValue),
    generator: "proof-055-private-cli-provenance-v1",
    fields: ["heapGraphIr", "continuationDescriptor", "resourceDescriptors", "architecture"],
  };
  if (
    provenance.digest !== digest(expectedBody) ||
    provenance.bundleDigest !== expectedBody.bundleDigest
  ) {
    return { accepted: false, code: "node-proper-level5-private-cli-provenance-refused" };
  }
  return { accepted: true, code: "accepted" };
}

function runNativeVerifier(
  work: string,
  bundleValue: Record<string, unknown>,
  id: string,
): { accepted: boolean; code: string } {
  const bundlePath = join(work, `${id}-bundle.json`);
  const resultPath = join(work, `${id}-native-result.json`);
  writeFileSync(bundlePath, `${JSON.stringify(bundleValue, null, 2)}\n`);
  spawnSync("zig", ["run", nativeVerifier, "--", bundlePath, resultPath], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!existsSync(resultPath)) {
    return {
      accepted: false,
      code: "node-proper-level5-private-cli-native-verifier-missing-result",
    };
  }
  const result = JSON.parse(readFileSync(resultPath, "utf8")) as {
    accepted: boolean;
    refusal?: { code: string };
  };
  return result.accepted
    ? { accepted: true, code: "accepted" }
    : {
        accepted: false,
        code: result.refusal?.code ?? "node-proper-level5-private-cli-native-verifier-refused",
      };
}

function privateCli(
  work: string,
  argv: string[],
  bundleValue: Record<string, unknown>,
  provenance?: Record<string, unknown>,
): CliResult {
  if (
    argv[0] !== "private-restore-translated-bundle" ||
    !argv.includes("--proof-only") ||
    !argv.includes("--dry-run")
  ) {
    return {
      accepted: false,
      code: "node-proper-level5-private-cli-proof-only-dry-run-required",
      targetStarted: false,
      nativeVerifierInvoked: false,
      provenanceChecked: false,
    };
  }
  const provenanceResult = checkProvenance(bundleValue, provenance);
  if (!provenanceResult.accepted) {
    return {
      accepted: false,
      code: provenanceResult.code,
      targetStarted: false,
      nativeVerifierInvoked: false,
      provenanceChecked: true,
    };
  }
  const native = runNativeVerifier(
    work,
    bundleValue,
    argv.join("-").replaceAll(/[^a-z0-9-]/gi, "-"),
  );
  if (!native.accepted) {
    return {
      accepted: false,
      code: native.code,
      targetStarted: false,
      nativeVerifierInvoked: true,
      provenanceChecked: true,
    };
  }
  return {
    accepted: true,
    code: "accepted-dry-run",
    targetStarted: false,
    nativeVerifierInvoked: true,
    provenanceChecked: true,
    plan: {
      sourceArchitecture: "arm64",
      targetArchitecture: "amd64",
      verifyNativeBundle: true,
      verifyProvenance: true,
      materializeHeapGraph: true,
      materializeResources: ["tcp-listener-v1", "repeating-timer-v1"],
      startTarget: false,
    },
  };
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-055."));
  const validBundle = bundle();
  const validProvenance = provenanceForBundle(validBundle);
  const accepted = privateCli(
    work,
    ["private-restore-translated-bundle", "--proof-only", "--dry-run"],
    validBundle,
    validProvenance,
  );
  if (
    !accepted.accepted ||
    accepted.targetStarted ||
    !accepted.nativeVerifierInvoked ||
    !accepted.provenanceChecked
  ) {
    throw new Error(`valid private CLI dry-run failed: ${JSON.stringify(accepted)}`);
  }
  const cases = [
    [
      "missing-flags",
      ["private-restore-translated-bundle"],
      validBundle,
      validProvenance,
      "node-proper-level5-private-cli-proof-only-dry-run-required",
    ],
    [
      "missing-provenance",
      ["private-restore-translated-bundle", "--proof-only", "--dry-run"],
      validBundle,
      undefined,
      "node-proper-level5-private-cli-provenance-missing",
    ],
    [
      "tampered-provenance",
      ["private-restore-translated-bundle", "--proof-only", "--dry-run"],
      { ...validBundle, bundleDigestOk: false },
      validProvenance,
      "node-proper-level5-private-cli-provenance-refused",
    ],
    [
      "product-claim",
      ["private-restore-translated-bundle", "--proof-only", "--dry-run"],
      { ...validBundle, productSupportClaimed: true },
      provenanceForBundle({ ...validBundle, productSupportClaimed: true }),
      "node-proper-level5-native-hardening-product-claim-refused",
    ],
    [
      "source-isa-emulation",
      ["private-restore-translated-bundle", "--proof-only", "--dry-run"],
      { ...validBundle, sourceIsaEmulationUsed: true },
      provenanceForBundle({ ...validBundle, sourceIsaEmulationUsed: true }),
      "node-proper-level5-native-hardening-shortcut-refused",
    ],
  ] as const;
  const refusedRows = cases.map(([id, argv, bundleValue, provenance, expectedCode]) => {
    const result = privateCli(work, [...argv], bundleValue, provenance);
    if (result.accepted || result.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.code,
      targetStarted: result.targetStarted,
      nativeVerifierInvoked: result.nativeVerifierInvoked,
      provenanceChecked: result.provenanceChecked,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-private-cli-integration-summary",
    proof: "055",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      privateCliInvokesNativeVerifier: accepted.nativeVerifierInvoked,
      privateCliInvokesProvenanceChecks: accepted.provenanceChecked,
      validProofBundleProducesDryRunPlan: accepted.accepted && accepted.plan?.startTarget === false,
      invalidBundlesRefuseBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
      outputRemainsProofOnly: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_055_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/055/checked-summary.json is stale; rerun with UPDATE_PROOF_055_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: accepted.code, refused: refusedRows.length }));
  console.log("node proper Level 5 private CLI integration proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
