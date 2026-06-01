#!/usr/bin/env tsx
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const work =
  process.env.WORK_DIR ??
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-proof-041-cross-arch-composed."));
const containerName = `machinen-proof-041-target-${process.pid}`;
mkdirSync(work, { recursive: true });

interface TargetResponse {
  count: number;
  graphTotal: number;
  leftSharedIsRightShared: boolean;
  packedSharedIsSame: boolean;
  listenerOpen: boolean;
  timerRepeatMs: number;
}

interface ProofResult {
  sourceArchitecture: string;
  targetArchitecture: string;
  targetNativeNodeStarted: boolean;
  sourceIsaEmulationUsed: boolean;
  rawSourceRegistersCopiedToTarget: boolean;
  rawSourceStackCopiedToTarget: boolean;
  rawSourcePcCopiedToTarget: boolean;
  sourceKernelFdReusedOnTarget: boolean;
  sidecarReplayUsed: boolean;
  metadataOnlySuccess: boolean;
  appExportImportUsed: boolean;
}

function docker(args: string[], stdio: "inherit" | "ignore" = "inherit"): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

async function allocateHostPort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("could not allocate host port"));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

function buildBundle(): Record<string, unknown> {
  return {
    kind: "machinen.node-proper-level5-cross-arch-composed-bundle",
    proof: "041",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    architecture: { source: "arm64", target: "amd64", targetNativeRequired: true },
    heapGraphIr: { kind: "machinen.v8-supported-heap-graph-ir", total: 2, graphTotal: 2 },
    continuationDescriptor: {
      kind: "machinen.cross-arch-continuation-descriptor",
      continuationClass: "node-libuv-event-loop-wait-v1",
      sourceArchitecture: "arm64",
      targetArchitecture: "amd64",
      rawSourceRegistersCopiedToTarget: false,
      rawSourceStackCopiedToTarget: false,
      rawSourcePcCopiedToTarget: false,
      sourceIsaBytesExecuted: false,
      sourceIsaEmulationUsed: false,
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
    },
  };
}

async function waitForTarget(port: number): Promise<TargetResponse> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      return (await response.json()) as TargetResponse;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  try {
    process.stderr.write(docker(["logs", containerName], "ignore"));
  } catch {
    // Ignore log collection failures.
  }
  throw new Error("timed out waiting for amd64 target");
}

async function main(): Promise<void> {
  const bundle = buildBundle();
  const bundlePath = join(work, "bundle.json");
  const resultPath = join(work, "proof-result.json");
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  writeFileSync(join(work, "target-loader.mjs"), readFileSync(join(proofDir, "target-loader.mjs")));
  const port = await allocateHostPort();
  try {
    docker(
      [
        "run",
        "-d",
        "--rm",
        "--name",
        containerName,
        "--platform",
        "linux/amd64",
        "-v",
        `${work}:/mnt/work`,
        "-p",
        `127.0.0.1:${port}:3000`,
        "node:22-bookworm-slim",
        "node",
        "/mnt/work/target-loader.mjs",
        "/mnt/work/bundle.json",
        "/mnt/work/proof-result.json",
      ],
      "ignore",
    );
    const target = await waitForTarget(port);
    const proof = JSON.parse(readFileSync(resultPath, "utf8")) as ProofResult;
    if (proof.sourceArchitecture === proof.targetArchitecture) {
      throw new Error("source and target architectures did not differ");
    }
    if (proof.sourceArchitecture !== "arm64" || proof.targetArchitecture !== "amd64") {
      throw new Error(
        `unexpected architectures: ${proof.sourceArchitecture}->${proof.targetArchitecture}`,
      );
    }
    if (target.count !== 3 || target.graphTotal !== 3) {
      throw new Error(`target returned wrong state: ${JSON.stringify(target)}`);
    }
    if (!target.leftSharedIsRightShared || !target.packedSharedIsSame || !target.listenerOpen) {
      throw new Error(`target missing graph/resource evidence: ${JSON.stringify(target)}`);
    }
    for (const key of [
      "sourceIsaEmulationUsed",
      "rawSourceRegistersCopiedToTarget",
      "rawSourceStackCopiedToTarget",
      "rawSourcePcCopiedToTarget",
      "sourceKernelFdReusedOnTarget",
      "sidecarReplayUsed",
      "metadataOnlySuccess",
      "appExportImportUsed",
    ] as const) {
      if (proof[key]) {
        throw new Error(`forbidden shortcut detected: ${key}`);
      }
    }
    const targetForSummary = {
      count: target.count,
      graphTotal: target.graphTotal,
      leftSharedIsRightShared: target.leftSharedIsRightShared,
      packedSharedIsSame: target.packedSharedIsSame,
      listenerOpen: target.listenerOpen,
      timerRepeatMs: target.timerRepeatMs,
    };
    const checkedSummary = {
      kind: "machinen.node-proper-level5-cross-arch-composed-bundle-summary",
      proof: "041",
      scope: "proof-only-harness-not-product-support",
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      sourceArchitecture: proof.sourceArchitecture,
      targetArchitecture: proof.targetArchitecture,
      target: targetForSummary,
      assertions: {
        sourceAndTargetArchitecturesDiffer:
          String(proof.sourceArchitecture) !== String(proof.targetArchitecture),
        targetNativeNodeUsed:
          String(proof.targetArchitecture) === "amd64" && proof.targetNativeNodeStarted,
        targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
        sourceCpuStateEvidenceOnly:
          !proof.rawSourceRegistersCopiedToTarget && !proof.rawSourcePcCopiedToTarget,
        noSourceIsaEmulation: !proof.sourceIsaEmulationUsed,
        noForbiddenShortcutUsed: true,
      },
    };
    const summaryPath = join(proofDir, "checked-summary.json");
    const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
    if (process.env.UPDATE_PROOF_041_SUMMARY === "1" || !existsSync(summaryPath)) {
      writeFileSync(summaryPath, text);
    } else {
      const expected = JSON.parse(readFileSync(summaryPath, "utf8")) as unknown;
      if (JSON.stringify(expected) !== JSON.stringify(checkedSummary)) {
        throw new Error(
          "proofs/by-id/041/checked-summary.json is stale; rerun with UPDATE_PROOF_041_SUMMARY=1",
        );
      }
    }
    console.log(
      JSON.stringify({
        source: proof.sourceArchitecture,
        target: proof.targetArchitecture,
        response: target,
      }),
    );
    console.log("node proper Level 5 cross-architecture composed bundle proof passed");
  } finally {
    try {
      docker(["rm", "-f", containerName], "ignore");
    } catch {
      // Best-effort cleanup.
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
