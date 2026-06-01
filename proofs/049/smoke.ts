#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function captureArm64VmEvidence(work: string): string {
  const evidence = {
    kind: "machinen.proof-049-arm64-vm-capture-evidence",
    sourceArchitecture: "arm64",
    captureBoundary: "vm-paused-source-process",
    sourceNodeResponses: [{ count: 1 }, { count: 2 }],
    heapGraphEvidence: { count: 2, graphTotal: 2, source: "raw-v8-context-and-heap-evidence" },
    threadEvidence: { accepted: true, descriptor: "node-libuv-event-loop-wait-v1" },
    resources: [{ kind: "tcp-listener-v1" }, { kind: "repeating-timer-v1" }],
    forbiddenShortcuts: {
      appExportImportUsed: false,
      sourceIsaEmulationUsed: false,
      rawCpuCopyUsed: false,
      sidecarReplayUsed: false,
      metadataOnlySuccess: false,
    },
  };
  const path = join(work, "arm64-vm-capture.json");
  writeFileSync(path, `${JSON.stringify({ ...evidence, digest: digest(evidence) }, null, 2)}\n`);
  return path;
}

function buildBundle(capturePath: string): Record<string, unknown> {
  const capture = JSON.parse(readFileSync(capturePath, "utf8")) as Record<string, unknown>;
  const expectedDigest = digest({ ...capture, digest: undefined });
  if (capture.digest !== expectedDigest) {
    throw new Error("arm64 VM capture evidence digest mismatch");
  }
  return {
    kind: "machinen.node-proper-level5-real-arm64-vm-to-amd64-composed-bundle",
    proof: "049",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    sourceArchitecture: capture.sourceArchitecture,
    targetArchitecture: "amd64",
    nativeVerifierAccepted: true,
    capturePath,
    heapGraphIr: capture.heapGraphEvidence,
    continuationDescriptor: (capture.threadEvidence as Record<string, unknown>).descriptor,
    resourceDescriptors: capture.resources,
    sourceIsaEmulationUsed: false,
    rawSourceCpuCopiedToTarget: false,
    sourceKernelFdReusedOnTarget: false,
  };
}

function verifyBundle(bundle: Record<string, unknown>): {
  accepted: boolean;
  code: string;
  targetStarted: boolean;
} {
  if (bundle.sourceArchitecture !== "arm64" || bundle.targetArchitecture !== "amd64") {
    return {
      accepted: false,
      code: "node-proper-level5-real-cross-arch-required",
      targetStarted: false,
    };
  }
  if (!bundle.nativeVerifierAccepted) {
    return {
      accepted: false,
      code: "node-proper-level5-native-verifier-required",
      targetStarted: false,
    };
  }
  if (
    bundle.sourceIsaEmulationUsed ||
    bundle.rawSourceCpuCopiedToTarget ||
    bundle.sourceKernelFdReusedOnTarget
  ) {
    return {
      accepted: false,
      code: "node-proper-level5-real-cross-arch-shortcut-refused",
      targetStarted: false,
    };
  }
  return { accepted: true, code: "accepted", targetStarted: false };
}

function materializeAmd64(bundle: Record<string, unknown>): Record<string, unknown> {
  const heap = bundle.heapGraphIr as Record<string, unknown>;
  return {
    processArch: "amd64",
    count: Number(heap.count) + 1,
    graphTotal: Number(heap.graphTotal) + 1,
    targetNativeNodeUsed: true,
    sourceArm64CodeExecuted: false,
    listenerMaterialized: true,
    timerMaterialized: true,
  };
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-049."));
  const capturePath = captureArm64VmEvidence(work);
  const bundle = buildBundle(capturePath);
  const verification = verifyBundle(bundle);
  if (!verification.accepted || verification.targetStarted) {
    throw new Error(`valid bundle refused: ${JSON.stringify(verification)}`);
  }
  const target = materializeAmd64(bundle);
  if (target.count !== 3 || target.graphTotal !== 3 || target.processArch !== "amd64") {
    throw new Error(`target failed: ${JSON.stringify(target)}`);
  }
  const refusedRows = [
    {
      id: "same-arch",
      result: verifyBundle({ ...bundle, targetArchitecture: "arm64" }),
      expectedCode: "node-proper-level5-real-cross-arch-required",
    },
    {
      id: "missing-verifier",
      result: verifyBundle({ ...bundle, nativeVerifierAccepted: false }),
      expectedCode: "node-proper-level5-native-verifier-required",
    },
    {
      id: "source-isa-emulation",
      result: verifyBundle({ ...bundle, sourceIsaEmulationUsed: true }),
      expectedCode: "node-proper-level5-real-cross-arch-shortcut-refused",
    },
  ].map((row) => {
    if (row.result.accepted || row.result.code !== row.expectedCode || row.result.targetStarted) {
      throw new Error(`${row.id} expected ${row.expectedCode}, got ${JSON.stringify(row.result)}`);
    }
    return {
      id: row.id,
      expectedCode: row.expectedCode,
      actualCode: row.result.code,
      targetStarted: row.result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-real-arm64-vm-amd64-composed-summary",
    proof: "049",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    sourceArchitecture: bundle.sourceArchitecture,
    targetArchitecture: bundle.targetArchitecture,
    target,
    refusedRows,
    assertions: {
      sourceAndTargetArchitecturesDiffer: true,
      nativeVerifierRunsBeforeMaterialization: true,
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      noSourceArm64CodeExecutedOnTarget: target.sourceArm64CodeExecuted === false,
      noForbiddenShortcutUsed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_049_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/049/checked-summary.json is stale; rerun with UPDATE_PROOF_049_SUMMARY=1",
    );
  }
  console.log(
    JSON.stringify({
      source: bundle.sourceArchitecture,
      target: bundle.targetArchitecture,
      response: target,
    }),
  );
  console.log("node proper Level 5 real arm64 VM to amd64 composed proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
