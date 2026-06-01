#!/usr/bin/env tsx
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const sections = [
  "architecture",
  "heapGraphIr",
  "continuationDescriptor",
  "resourceDescriptors",
  "threadEvidence",
];
function writeArtifacts(dir: string, tamper = false): void {
  mkdirSync(dir, { recursive: true });
  for (const section of sections) {
    writeFileSync(
      join(dir, `${section}.artifact.json`),
      `${JSON.stringify({ section, generator: tamper && section === "heapGraphIr" ? "manual" : "proof-058-capture-tool-v1", handAuthored: false, payload: { section } }, null, 2)}\n`,
    );
  }
}
function assemble(
  work: string,
  id: string,
  artifactDir: string,
): { result: Record<string, unknown>; bundle?: Record<string, unknown> } {
  const bundlePath = join(work, `${id}-bundle.json`);
  const resultPath = join(work, `${id}-result.json`);
  spawnSync(
    "zig",
    [
      "run",
      join(proofDir, "native-bundle-assembler.zig"),
      "--",
      artifactDir,
      bundlePath,
      resultPath,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  if (!existsSync(resultPath)) {
    throw new Error(`missing assembler result for ${id}`);
  }
  return {
    result: JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, unknown>,
    bundle: existsSync(bundlePath)
      ? (JSON.parse(readFileSync(bundlePath, "utf8")) as Record<string, unknown>)
      : undefined,
  };
}
function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-058."));
  const artifactDir = join(work, "artifacts");
  writeArtifacts(artifactDir);
  const accepted = assemble(work, "valid", artifactDir);
  if (
    accepted.result.accepted !== true ||
    accepted.bundle?.assembledByNativeCode !== true ||
    accepted.bundle.sectionCount !== sections.length
  ) {
    throw new Error(`native assembler failed: ${JSON.stringify(accepted)}`);
  }
  const heap = accepted.bundle.heapGraphIr as Record<string, unknown>;
  const target = {
    count: Number(heap.count) + 1,
    graphTotal: Number(heap.graphTotal) + 1,
    targetNative: true,
  };
  const tamperedDir = join(work, "tampered");
  writeArtifacts(tamperedDir, true);
  const missingDir = join(work, "missing");
  mkdirSync(missingDir);
  const refusedRows = [
    {
      id: "missing",
      out: assemble(work, "missing", missingDir),
      expectedCode: "node-proper-level5-native-assembler-artifact-missing",
    },
    {
      id: "tampered",
      out: assemble(work, "tampered", tamperedDir),
      expectedCode: "node-proper-level5-native-assembler-artifact-refused",
    },
  ].map((row) => {
    const refusal = row.out.result.refusal as { code?: string } | undefined;
    if (
      row.out.result.accepted ||
      refusal?.code !== row.expectedCode ||
      row.out.result.targetStarted
    ) {
      throw new Error(`${row.id} failed: ${JSON.stringify(row.out)}`);
    }
    return {
      id: row.id,
      expectedCode: row.expectedCode,
      actualCode: refusal.code,
      targetStarted: row.out.result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-native-bundle-assembler-summary",
    proof: "058",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted: accepted.result,
    target,
    refusedRows,
    assertions: {
      nativeAssemblerBuiltBundle: true,
      targetReturnedNextState: target.count === 3,
      invalidArtifactsRefuseBeforeTargetStart: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_058_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/058/checked-summary.json is stale; rerun with UPDATE_PROOF_058_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 058 native bundle assembler passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
