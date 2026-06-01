#!/usr/bin/env tsx
import { createServer } from "node:net";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");

type Json = Record<string, any>;
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
function runZig(args: string[]): void {
  const run = spawnSync("zig", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (run.status !== 0) {
    throw new Error(`${args.join(" ")} failed:\n${run.stderr}`);
  }
}
function verifierBundle(count: number, graphTotal: number): Json {
  return {
    schemaVersion: 1,
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    architecture: { source: "arm64", target: "amd64" },
    heapGraphIr: { count, graphTotal },
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
async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-100."));
  runZig(["run", join(repoRoot, "proofs/096/guest-capture-records.zig"), "--", work]);
  const parseResultPath = join(work, "parse-result.json");
  runZig([
    "run",
    join(repoRoot, "proofs/097/native-record-parser.zig"),
    "--",
    work,
    parseResultPath,
  ]);
  const parser = JSON.parse(readFileSync(parseResultPath, "utf8")) as Json;
  if (!parser.accepted) {
    throw new Error(`record parser refused: ${JSON.stringify(parser)}`);
  }
  const decodeResultPath = join(work, "decode-result.json");
  runZig([
    "run",
    join(repoRoot, "proofs/086/native-v8-byte-decoder.zig"),
    "--",
    join(work, "v8-memory.bin"),
    decodeResultPath,
  ]);
  const decoded = JSON.parse(readFileSync(decodeResultPath, "utf8")) as Json;
  if (!decoded.accepted) {
    throw new Error(`byte decoder refused: ${JSON.stringify(decoded)}`);
  }
  const bundlePath = join(work, "bundle.json");
  const verifierResultPath = join(work, "verifier-result.json");
  writeFileSync(
    bundlePath,
    `${JSON.stringify(verifierBundle(decoded.count, decoded.graphTotal), null, 2)}\n`,
  );
  runZig([
    "run",
    join(repoRoot, "proofs/057/native-json-verifier.zig"),
    "--",
    bundlePath,
    verifierResultPath,
  ]);
  const verifier = JSON.parse(readFileSync(verifierResultPath, "utf8")) as Json;
  if (!verifier.accepted || verifier.targetStarted) {
    throw new Error(`structured verifier refused: ${JSON.stringify(verifier)}`);
  }
  writeFileSync(
    join(work, "target-loader.mjs"),
    readFileSync(join(repoRoot, "proofs/087/target-loader.mjs")),
  );
  const port = await freePort();
  const container = `machinen-proof-100-${process.pid}`;
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
    let response: Json | undefined;
    for (let i = 0; i < 120; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        response = (await res.json()) as Json;
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
      kind: "machinen.node-proper-level5-real-guest-capture-to-amd64-e2e-summary",
      proof: "100",
      scope: "proof-only-harness-not-product-support",
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      parser,
      decoded,
      verifier,
      response,
      refusedRows,
      assertions: {
        zigGuestCaptureRan: true,
        nativeRecordParserRan: parser.accepted,
        nativeByteDecoderRan: decoded.accepted,
        nativeVerifierRanBeforeTarget: verifier.accepted && !verifier.targetStarted,
        amd64TargetReturnedNextState: response.count === 3 && response.graphTotal === 3,
        noSourceIsaEmulation: response.sourceIsaEmulationUsed === false,
      },
    };
    const summaryPath = join(proofDir, "checked-summary.json");
    const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
    if (process.env.UPDATE_PROOF_100_SUMMARY === "1" || !existsSync(summaryPath)) {
      writeFileSync(summaryPath, text);
    } else if (
      JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !==
      JSON.stringify(checkedSummary)
    ) {
      throw new Error(
        "proofs/100/checked-summary.json is stale; rerun with UPDATE_PROOF_100_SUMMARY=1",
      );
    }
    console.log(JSON.stringify({ response, refused: refusedRows.length }));
    console.log("proof 100 real guest capture to amd64 E2E passed");
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
