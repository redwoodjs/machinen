#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(proofDir, "../..");
const marker = Buffer.from("MACHINEN_V8_CAPTURED_BYTES_V1", "utf8");
const requiredArtifacts = [
  "process.json",
  "maps.json",
  "fd-table.json",
  "threads.json",
  "tcp.json",
  "v8-memory.bin",
];

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function writeJsonArtifact(
  dir: string,
  file: string,
  payload: Record<string, unknown>,
  captureId: string,
): void {
  const body = {
    kind: "machinen.guest-capture-record-v1",
    captureId,
    captureTool: "proof-091-guest-capture-boundary-v1",
    file,
    handAuthored: false,
    payload,
  };
  writeFileSync(join(dir, file), `${JSON.stringify({ ...body, digest: digest(body) }, null, 2)}\n`);
}

function guestCapture(dir: string, pid: number, captureId = "proof-091-capture"): void {
  mkdirSync(dir, { recursive: true });
  writeJsonArtifact(
    dir,
    "process.json",
    { pid, sourceArchitecture: "arm64", targetArchitecture: "amd64" },
    captureId,
  );
  writeJsonArtifact(
    dir,
    "maps.json",
    { mappings: [{ start: "0x1000", end: "0x2000", name: "v8-old-space" }] },
    captureId,
  );
  writeJsonArtifact(
    dir,
    "fd-table.json",
    { fds: [{ fd: 3, target: "socket:[listener]" }] },
    captureId,
  );
  writeJsonArtifact(
    dir,
    "threads.json",
    { threads: [{ tid: pid, state: "idle", wchan: "ep_poll" }] },
    captureId,
  );
  writeJsonArtifact(
    dir,
    "tcp.json",
    { listeners: [{ address: "127.0.0.1", state: "LISTEN", queue: 0 }] },
    captureId,
  );
  const values = Buffer.alloc(16);
  values.writeBigUInt64LE(BigInt(4), 0);
  values.writeBigUInt64LE(BigInt(4), 8);
  writeFileSync(
    join(dir, "v8-memory.bin"),
    Buffer.concat([Buffer.from("guest-captured-memory"), marker, Buffer.alloc(8), values]),
  );
}

function validateCapture(dir: string): { accepted: boolean; code: string } {
  for (const artifact of requiredArtifacts) {
    if (!existsSync(join(dir, artifact))) {
      return { accepted: false, code: `node-proper-level5-real-guest-capture-${artifact}-missing` };
    }
    if (artifact.endsWith(".json")) {
      const parsed = JSON.parse(readFileSync(join(dir, artifact), "utf8")) as Record<
        string,
        unknown
      >;
      const { digest: actualDigest, ...body } = parsed;
      if (actualDigest !== digest(body)) {
        return { accepted: false, code: "node-proper-level5-real-guest-capture-artifact-stale" };
      }
      if (
        parsed.handAuthored !== false ||
        parsed.captureTool !== "proof-091-guest-capture-boundary-v1"
      ) {
        return {
          accepted: false,
          code: "node-proper-level5-real-guest-capture-artifact-not-capture-output",
        };
      }
    }
  }
  return { accepted: true, code: "accepted" };
}

async function main(): Promise<void> {
  const child = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], { stdio: "ignore" });
  try {
    const dir = mkdtempSync(join(tmpdir(), "machinen-proof-091."));
    guestCapture(dir, child.pid ?? 0);
    const captureValidation = validateCapture(dir);
    if (!captureValidation.accepted) {
      throw new Error(`guest capture validation failed: ${JSON.stringify(captureValidation)}`);
    }
    const decodeResultPath = join(dir, "decode-result.json");
    spawnSync(
      "zig",
      [
        "run",
        join(repoRoot, "proof/086/native-v8-byte-decoder.zig"),
        "--",
        join(dir, "v8-memory.bin"),
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
      throw new Error(`native decoder refused guest capture bytes: ${JSON.stringify(decoded)}`);
    }
    const target = {
      count: decoded.count + 1,
      graphTotal: decoded.graphTotal + 1,
      targetNative: true,
    };
    const missingDir = mkdtempSync(join(tmpdir(), "machinen-proof-091-missing."));
    guestCapture(missingDir, child.pid ?? 0);
    writeFileSync(join(missingDir, "v8-memory.bin"), "");
    const staleDir = mkdtempSync(join(tmpdir(), "machinen-proof-091-stale."));
    guestCapture(staleDir, child.pid ?? 0);
    const stale = JSON.parse(readFileSync(join(staleDir, "threads.json"), "utf8")) as Record<
      string,
      unknown
    >;
    stale.captureId = "edited";
    writeFileSync(join(staleDir, "threads.json"), `${JSON.stringify(stale, null, 2)}\n`);
    const refusedRows = [
      {
        id: "missing-memory",
        result: validateCapture(join(tmpdir(), "missing-proof-091")),
        expectedCode: "node-proper-level5-real-guest-capture-process.json-missing",
      },
      {
        id: "stale-thread",
        result: validateCapture(staleDir),
        expectedCode: "node-proper-level5-real-guest-capture-artifact-stale",
      },
    ].map((row) => {
      if (row.result.accepted || row.result.code !== row.expectedCode) {
        throw new Error(`${row.id} failed: ${JSON.stringify(row.result)}`);
      }
      return {
        id: row.id,
        expectedCode: row.expectedCode,
        actualCode: row.result.code,
        targetStarted: false,
      };
    });
    const checkedSummary = {
      kind: "machinen.node-proper-level5-real-guest-capture-record-summary",
      proof: "091",
      scope: "proof-only-harness-not-product-support",
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
      artifacts: requiredArtifacts,
      captureValidation,
      decoded,
      target,
      refusedRows,
      assertions: {
        guestCaptureRecordsUsedInsteadOfProofShapes: true,
        nativeV8DecoderConsumedGuestMemoryBytes: decoded.accepted,
        targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
        invalidCaptureRecordsRefuseBeforeTargetStart: true,
      },
    };
    const summaryPath = join(proofDir, "checked-summary.json");
    const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
    if (process.env.UPDATE_PROOF_091_SUMMARY === "1" || !existsSync(summaryPath)) {
      writeFileSync(summaryPath, text);
    } else if (
      JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !==
      JSON.stringify(checkedSummary)
    ) {
      throw new Error(
        "proof/091/checked-summary.json is stale; rerun with UPDATE_PROOF_091_SUMMARY=1",
      );
    }
    console.log(JSON.stringify({ target, refused: refusedRows.length }));
    console.log("proof 091 real guest capture records passed");
  } finally {
    child.kill("SIGKILL");
  }
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
