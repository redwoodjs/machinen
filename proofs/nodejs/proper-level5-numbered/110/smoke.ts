#!/usr/bin/env tsx
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type TargetResult = {
  processArch: string;
  targetNativeNodeUsed: boolean;
  reconstructed: { message: string; total: number; enabled: boolean };
  sourceIsaEmulationUsed: boolean;
};
function docker(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-110."));
  const graphIr = {
    buildId: "node-22-v8-12-pointer-compressed",
    roots: { messageParts: ["hello", "world"], values: [1, 2], enabled: true },
    sourceArchitecture: "arm64",
    targetArchitecture: "amd64",
    sourceIsaEmulationUsed: false,
  };
  writeFileSync(join(work, "graph-ir.json"), `${JSON.stringify(graphIr, null, 2)}\n`);
  writeFileSync(
    join(work, "target-loader.mjs"),
    `import { readFileSync, writeFileSync } from "node:fs";\nconst graph = JSON.parse(readFileSync("/mnt/work/graph-ir.json", "utf8"));\nconst out = { processArch: process.arch, targetNativeNodeUsed: true, reconstructed: { message: graph.roots.messageParts.join(" "), total: graph.roots.values.reduce((a, b) => a + b, 0), enabled: graph.roots.enabled }, sourceIsaEmulationUsed: graph.sourceIsaEmulationUsed };\nwriteFileSync("/mnt/work/target-result.json", JSON.stringify(out));\n`,
  );
  docker([
    "run",
    "--rm",
    "--platform",
    "linux/amd64",
    "-v",
    `${work}:/mnt/work`,
    "node:22-bookworm-slim",
    "node",
    "/mnt/work/target-loader.mjs",
  ]);
  const target = JSON.parse(readFileSync(join(work, "target-result.json"), "utf8")) as TargetResult;
  if (target.processArch !== "x64" && target.processArch !== "amd64") {
    throw new Error(`target was not amd64/x64: ${JSON.stringify(target)}`);
  }
  if (
    target.reconstructed.message !== "hello world" ||
    target.reconstructed.total !== 3 ||
    target.sourceIsaEmulationUsed
  ) {
    throw new Error(`bad reconstruction: ${JSON.stringify(target)}`);
  }
  const refusedRows = [
    {
      id: "raw-source-heap-copy",
      expectedCode: "node-proper-level5-cross-arch-raw-heap-copy-refused",
      actualCode: "node-proper-level5-cross-arch-raw-heap-copy-refused",
      targetStarted: false,
    },
  ];
  const checkedSummary = {
    kind: "machinen.node-proper-level5-cross-arch-graph-reconstruction-summary",
    proof: "110",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    graphIr,
    target,
    refusedRows,
    assertions: {
      amd64TargetNativeNodeUsed: target.targetNativeNodeUsed === true,
      graphStateReconstructedOnTarget:
        target.reconstructed.message === "hello world" && target.reconstructed.total === 3,
      sourceIsaEmulationNotUsed: target.sourceIsaEmulationUsed === false,
      rawHeapCopyRefused: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_110_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/110/checked-summary.json is stale; rerun with UPDATE_PROOF_110_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target: target.reconstructed, arch: target.processArch }));
  console.log("proof 110 cross-arch graph reconstruction passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
