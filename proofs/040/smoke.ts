#!/usr/bin/env tsx
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const work =
  process.env.WORK_DIR ??
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-proof-040-native-verifier."));
mkdirSync(work, { recursive: true });

interface ProofResult {
  accepted: boolean;
  targetNativeVerifierStarted: boolean;
  targetNodeStarted?: boolean;
  targetMaterialized?: boolean;
  targetPort?: number;
  sourceArchitecture?: string;
  targetArchitecture?: string;
  refusal?: { code: string };
  sourceCpuStateCopiedToTarget?: boolean;
  sourceKernelFdReusedOnTarget?: boolean;
  sourceLibuvHandleCopiedToTarget?: boolean;
  sourceIsaEmulationUsed?: boolean;
  sidecarReplayUsed?: boolean;
  metadataOnlySuccess?: boolean;
  productSupportClaimed?: boolean;
  broadLevel5ImplementationClaimed?: boolean;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function validBundle(): Record<string, unknown> {
  return {
    kind: "machinen.node-proper-level5-emitted-translated-continuation-bundle",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    architecture: { source: "arm64", target: "amd64", targetNativeRequired: true },
    heapGraphIr: { kind: "machinen.v8-supported-heap-graph-ir", total: 2 },
    continuationDescriptor: {
      kind: "machinen.cross-arch-continuation-descriptor",
      continuationClass: "node-libuv-event-loop-wait-v1",
      sourceArchitecture: "arm64",
      targetArchitecture: "amd64",
      rawSourceRegistersCopiedToTarget: false,
      rawSourceStackCopiedToTarget: false,
      rawSourcePcCopiedToTarget: false,
    },
    resourceDescriptors: [
      { kind: "tcp-listener-v1", sourceKernelFdCopiedToTarget: false },
      { kind: "repeating-timer-v1", sourceKernelTimerCopiedToTarget: false },
    ],
    refusalPolicy: {
      refusedRows: [{ code: "node-proper-level5-http-active-request-unsupported" }],
    },
    forbiddenShortcuts: {
      appHookUsed: false,
      checkpointApiUsed: false,
      selectedStateDescriptorUsed: false,
      sourceIsaEmulationUsed: false,
      sidecarReplayUsed: false,
      metadataOnlySuccess: false,
      sourceKernelFdReusedOnTarget: false,
      sourceLibuvHandleCopiedToTarget: false,
    },
  };
}

function compileVerifier(): string {
  const binary = join(work, "native-bundle-verifier");
  execFileSync(
    "zig",
    [
      "build-exe",
      join(proofDir, "native-bundle-verifier.zig"),
      "-O",
      "ReleaseFast",
      `-femit-bin=${binary}`,
    ],
    { stdio: "inherit" },
  );
  return binary;
}

function runVerifier(binary: string, bundle: Record<string, unknown>, id: string): ProofResult {
  const bundlePath = join(work, `${id}-bundle.json`);
  const resultPath = join(work, `${id}-result.json`);
  const entrypointPath = join(work, `${id}-target.mjs`);
  rmSync(resultPath, { force: true });
  rmSync(entrypointPath, { force: true });
  writeJson(bundlePath, bundle);
  try {
    execFileSync(binary, [bundlePath, resultPath, entrypointPath], { stdio: "ignore" });
  } catch {
    // Refusals intentionally exit non-zero after writing a result.
  }
  const result = readJson<ProofResult>(resultPath);
  if (!result.accepted && existsSync(entrypointPath)) {
    throw new Error(`${id} wrote a target entrypoint despite refusal`);
  }
  return result;
}

async function launchAcceptedTarget(
  entrypointPath: string,
  resultPath: string,
): Promise<{ count: number; graphTotal: number }> {
  const child = spawn(process.execPath, [entrypointPath], { stdio: "ignore" });
  try {
    let proof: ProofResult | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      proof = readJson<ProofResult>(resultPath);
      if (proof.targetPort) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!proof?.targetPort) {
      throw new Error("target entrypoint did not publish a port");
    }
    const response = await fetch(`http://127.0.0.1:${proof.targetPort}/`);
    return (await response.json()) as { count: number; graphTotal: number };
  } finally {
    child.kill();
  }
}

async function main(): Promise<void> {
  const binary = compileVerifier();
  const acceptedBundle = validBundle();
  const acceptedResultPath = join(work, "accepted-result.json");
  const acceptedEntrypointPath = join(work, "accepted-target.mjs");
  writeJson(join(work, "accepted-bundle.json"), acceptedBundle);
  execFileSync(
    binary,
    [join(work, "accepted-bundle.json"), acceptedResultPath, acceptedEntrypointPath],
    {
      stdio: "ignore",
    },
  );
  const acceptedProof = readJson<ProofResult>(acceptedResultPath);
  if (!acceptedProof.accepted || !acceptedProof.targetNativeVerifierStarted) {
    throw new Error("native verifier did not accept the valid bundle");
  }
  const target = await launchAcceptedTarget(acceptedEntrypointPath, acceptedResultPath);
  if (target.count !== 3 || target.graphTotal !== 3) {
    throw new Error(`target returned wrong state: ${JSON.stringify(target)}`);
  }

  const cases: Array<[string, string, (bundle: Record<string, unknown>) => void]> = [
    [
      "missing-heap",
      "node-proper-level5-native-verifier-heap-graph-missing",
      (bundle) => delete bundle.heapGraphIr,
    ],
    [
      "bad-arch",
      "node-proper-level5-native-verifier-architecture-mismatch",
      (bundle) => ((bundle.architecture as Record<string, unknown>).target = "arm64"),
    ],
    [
      "raw-cpu",
      "node-proper-level5-native-verifier-raw-cpu-copy-forbidden",
      (bundle) =>
        ((
          bundle.continuationDescriptor as Record<string, unknown>
        ).rawSourceRegistersCopiedToTarget = true),
    ],
    [
      "source-fd",
      "node-proper-level5-native-verifier-source-resource-reuse-forbidden",
      (bundle) =>
        ((
          bundle.resourceDescriptors as Array<Record<string, unknown>>
        )[0].sourceKernelFdCopiedToTarget = true),
    ],
    [
      "product-claim",
      "node-proper-level5-native-verifier-product-claim-forbidden",
      (bundle) => (bundle.productSupportClaimed = true),
    ],
    [
      "shortcut",
      "node-proper-level5-native-verifier-forbidden-shortcut",
      (bundle) =>
        ((bundle.forbiddenShortcuts as Record<string, unknown>).metadataOnlySuccess = true),
    ],
  ];
  const refusedRows = cases.map(([id, expectedCode, mutate]) => {
    const bundle = structuredClone(acceptedBundle) as Record<string, unknown>;
    mutate(bundle);
    const result = runVerifier(binary, bundle, id);
    if (result.accepted || result.refusal?.code !== expectedCode) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    if (result.targetNodeStarted || result.targetMaterialized) {
      throw new Error(`${id} started target materialization despite refusal`);
    }
    return { id, expectedCode, actualCode: result.refusal.code, materializerStarted: false };
  });

  const finalProof = readJson<ProofResult>(acceptedResultPath);
  const checkedSummary = {
    kind: "machinen.node-proper-level5-native-bundle-verifier-summary",
    proof: "040",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted: {
      verifierAccepted: acceptedProof.accepted,
      targetNativeVerifierStarted: acceptedProof.targetNativeVerifierStarted,
      targetNodeStarted: finalProof.targetNodeStarted,
      targetMaterialized: finalProof.targetMaterialized,
      sourceArchitecture: finalProof.sourceArchitecture,
      targetArchitecture: finalProof.targetArchitecture,
      target,
    },
    refusedRows,
    assertions: {
      validBundlePassedNativeVerifier: acceptedProof.accepted,
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      refusedBeforeNodeStarted: refusedRows.length === cases.length,
      noSourceCpuStateCopied: !finalProof.sourceCpuStateCopiedToTarget,
      noSourceFdReuse: !finalProof.sourceKernelFdReusedOnTarget,
      noForbiddenShortcutUsed:
        !finalProof.sourceIsaEmulationUsed &&
        !finalProof.sidecarReplayUsed &&
        !finalProof.metadataOnlySuccess,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_040_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else {
    const expected = JSON.parse(readFileSync(summaryPath, "utf8")) as unknown;
    if (JSON.stringify(expected) !== JSON.stringify(checkedSummary)) {
      throw new Error(
        "proofs/040/checked-summary.json is stale; rerun with UPDATE_PROOF_040_SUMMARY=1",
      );
    }
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length, summary: summaryPath }));
  console.log("node proper Level 5 native translated bundle verifier proof passed");
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
