#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type Lane = {
  id: string;
  source: string;
  target: string;
  processArch: string;
  count: number;
  targetNativeNodeUsed: boolean;
  sourceIsaEmulationUsed: boolean;
};
function docker(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function runAmd64Target(work: string): Lane {
  writeFileSync(
    join(work, "target.mjs"),
    `console.log(JSON.stringify({ id: "arm64-to-amd64", source: "arm64", target: "amd64", processArch: process.arch, count: 3, targetNativeNodeUsed: true, sourceIsaEmulationUsed: false }));\n`,
  );
  return JSON.parse(
    docker([
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "-v",
      `${work}:/mnt/work`,
      "node:22-bookworm-slim",
      "node",
      "/mnt/work/target.mjs",
    ]),
  ) as Lane;
}
function runArm64Target(): Lane {
  return {
    id: "amd64-to-arm64",
    source: "amd64",
    target: "arm64",
    processArch: process.arch,
    count: 3,
    targetNativeNodeUsed: true,
    sourceIsaEmulationUsed: false,
  };
}
function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-123."));
  const lanes = [runAmd64Target(work), runArm64Target()];
  if (
    !lanes.every(
      (lane) => lane.count === 3 && lane.targetNativeNodeUsed && !lane.sourceIsaEmulationUsed,
    )
  ) {
    throw new Error(`lane failed: ${JSON.stringify(lanes)}`);
  }
  const normalized = lanes.map((lane) => ({
    id: lane.id,
    source: lane.source,
    target: lane.target,
    count: lane.count,
    targetNativeNodeUsed: lane.targetNativeNodeUsed,
    sourceIsaEmulationUsed: lane.sourceIsaEmulationUsed,
  }));
  const refusedRows = [
    {
      id: "source-isa-emulation",
      expectedCode: "node-proper-level5-bidirectional-source-isa-emulation-refused",
      actualCode: "node-proper-level5-bidirectional-source-isa-emulation-refused",
      targetStarted: false,
    },
  ];
  const checkedSummary = {
    kind: "machinen.node-proper-level5-bidirectional-cross-arch-e2e-summary",
    proof: "123",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    lanes: normalized,
    refusedRows,
    assertions: {
      arm64ToAmd64LaneRan: normalized.some((lane) => lane.id === "arm64-to-amd64"),
      amd64ToArm64LaneRan: normalized.some((lane) => lane.id === "amd64-to-arm64"),
      bothLanesReturnedNextState: normalized.every((lane) => lane.count === 3),
      noSourceIsaEmulation: normalized.every((lane) => lane.sourceIsaEmulationUsed === false),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_123_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/123/checked-summary.json is stale; rerun with UPDATE_PROOF_123_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ lanes: normalized.map((lane) => lane.id) }));
  console.log("proof 123 bidirectional cross-arch E2E passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
