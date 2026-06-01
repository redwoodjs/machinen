#!/usr/bin/env tsx
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const proofDir = dirname(fileURLToPath(import.meta.url));
type Result = {
  accepted: boolean;
  targetStarted: boolean;
  resourceCount?: number;
  refusal?: { code: string; record: string };
};
function verify(work: string, id: string, lines: string): Result {
  const input = join(work, `${id}.txt`);
  const output = join(work, `${id}-result.json`);
  writeFileSync(input, lines);
  spawnSync(
    "zig",
    ["run", join(proofDir, "native-kernel-resource-verifier.zig"), "--", input, output],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(readFileSync(output, "utf8")) as Result;
}
function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-119."));
  const accepted = verify(
    work,
    "valid",
    "fd=3 kind=tcp-listener safe=true sourceCopied=false\nfd=4 kind=timerfd safe=true sourceCopied=false\nfd=5 kind=pipe safe=true sourceCopied=false\nfd=6 kind=file-ro safe=true sourceCopied=false\n",
  );
  if (!accepted.accepted || accepted.resourceCount !== 4) {
    throw new Error(`native resource verifier refused: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, string, string]> = [
    [
      "unsafe",
      "fd=3 kind=tcp-listener safe=false sourceCopied=false\n",
      "node-proper-level5-native-kernel-resource-unsafe",
    ],
    [
      "source-copy",
      "fd=3 kind=tcp-listener safe=true sourceCopied=true\n",
      "node-proper-level5-native-kernel-source-handle-copy-refused",
    ],
    [
      "unknown",
      "fd=9 kind=gpu safe=true sourceCopied=false\n",
      "node-proper-level5-native-kernel-resource-kind-unsupported",
    ],
  ];
  const refusedRows = cases.map(([id, lines, expectedCode]) => {
    const result = verify(work, id, lines);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} failed: ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-native-kernel-resource-verifier-summary",
    proof: "119",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      nativeKernelResourceVerifierRan: true,
      kernelResourceRecordsAccepted: accepted.resourceCount === 4,
      unsafeResourcesRefuseBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
      sourceHandlesNotCopied: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_119_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/119/checked-summary.json is stale; rerun with UPDATE_PROOF_119_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ resources: accepted.resourceCount, refused: refusedRows.length }));
  console.log("proof 119 native kernel resource verifier passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
