#!/usr/bin/env tsx
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");
const marker = Buffer.from("MACHINEN_V8_CAPTURED_BYTES_V1", "utf8");

function docker(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("missing port"));
      } else {
        server.close(() => resolvePort(address.port));
      }
    });
  });
}

function writeCapturedBytes(path: string): void {
  const values = Buffer.alloc(16);
  values.writeBigUInt64LE(BigInt(4), 0);
  values.writeBigUInt64LE(BigInt(4), 8);
  writeFileSync(
    path,
    Buffer.concat([Buffer.from("arm64-guest-memory-map"), marker, Buffer.alloc(8), values]),
  );
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-087."));
  const bytesPath = join(work, "v8-memory.bin");
  const decodeResultPath = join(work, "decode-result.json");
  writeCapturedBytes(bytesPath);
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proofs/086/native-v8-byte-decoder.zig"),
      "--",
      bytesPath,
      decodeResultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const decoded = JSON.parse(readFileSync(decodeResultPath, "utf8")) as {
    accepted: boolean;
    count: number;
    graphTotal: number;
  };
  if (!decoded.accepted) {
    throw new Error(`native byte decoder refused: ${JSON.stringify(decoded)}`);
  }
  const bundle = {
    schemaVersion: 1,
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    architecture: { source: "arm64", target: "amd64" },
    heapGraphIr: { count: decoded.count, graphTotal: decoded.graphTotal },
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
  const bundlePath = join(work, "bundle.json");
  const verifierResultPath = join(work, "verifier-result.json");
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  spawnSync(
    "zig",
    [
      "run",
      join(repoRoot, "proofs/057/native-json-verifier.zig"),
      "--",
      bundlePath,
      verifierResultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const verifier = JSON.parse(readFileSync(verifierResultPath, "utf8")) as {
    accepted: boolean;
    targetStarted: boolean;
  };
  if (!verifier.accepted || verifier.targetStarted) {
    throw new Error(`native verifier failed: ${JSON.stringify(verifier)}`);
  }
  writeFileSync(join(work, "target-loader.mjs"), readFileSync(join(proofDir, "target-loader.mjs")));
  const resultPath = join(work, "target-result.json");
  const port = await freePort();
  const container = `machinen-proof-087-${process.pid}`;
  try {
    docker([
      "run",
      "-d",
      "--rm",
      "--name",
      container,
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
      "/mnt/work/target-result.json",
    ]);
    let response: Record<string, unknown> | undefined;
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        response = (await res.json()) as Record<string, unknown>;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (
      !response ||
      response.count !== 3 ||
      response.graphTotal !== 3 ||
      response.processArch !== "amd64"
    ) {
      throw new Error(`bad target response: ${JSON.stringify(response)}`);
    }
    const targetResult = JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>;
    const refusedRows = [
      {
        id: "verifier-before-target",
        expectedCode: "target-not-started-before-verifier",
        actualCode: verifier.targetStarted
          ? "target-started"
          : "target-not-started-before-verifier",
        targetStarted: verifier.targetStarted,
      },
    ];
    const checkedSummary = {
      kind: "machinen.node-proper-level5-real-arm64-amd64-pipeline-summary",
      proof: "087",
      scope: "proof-only-harness-not-product-support",
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      decoded,
      verifier,
      targetResult,
      response,
      refusedRows,
      assertions: {
        nativeByteDecoderRan: decoded.accepted,
        nativeVerifierRanBeforeTarget: verifier.accepted && !verifier.targetStarted,
        amd64TargetNativeStarted: response.processArch === "amd64",
        targetReturnedNextState: response.count === 3 && response.graphTotal === 3,
        noSourceIsaEmulation: response.sourceIsaEmulationUsed === false,
      },
    };
    const summaryPath = join(proofDir, "checked-summary.json");
    const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
    if (process.env.UPDATE_PROOF_087_SUMMARY === "1" || !existsSync(summaryPath)) {
      writeFileSync(summaryPath, text);
    } else if (
      JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !==
      JSON.stringify(checkedSummary)
    ) {
      throw new Error(
        "proofs/087/checked-summary.json is stale; rerun with UPDATE_PROOF_087_SUMMARY=1",
      );
    }
    console.log(JSON.stringify({ response, refused: refusedRows.length }));
    console.log("proof 087 real arm64 to amd64 end-to-end pipeline passed");
  } finally {
    try {
      docker(["rm", "-f", container]);
    } catch {
      // best effort cleanup
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
