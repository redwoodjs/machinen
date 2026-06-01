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
  threadCount?: number;
  refusal?: { code: string; threadIndex: number };
};
function verify(work: string, id: string, lines: string): Result {
  const input = join(work, `${id}-threads.txt`);
  const output = join(work, `${id}-result.json`);
  writeFileSync(input, lines);
  spawnSync("zig", ["run", join(proofDir, "native-thread-set-verifier.zig"), "--", input, output], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(readFileSync(output, "utf8")) as Result;
}
function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-116."));
  const accepted = verify(
    work,
    "valid",
    "tid=10 state=idle wchan=ep_poll\ntid=11 state=idle wchan=futex_wait\n",
  );
  if (!accepted.accepted || accepted.threadCount !== 2 || accepted.targetStarted) {
    throw new Error(`thread verifier refused: ${JSON.stringify(accepted)}`);
  }
  const cases: Array<[string, string, string]> = [
    ["running", "tid=10 state=running wchan=cpu\n", "node-proper-level5-native-thread-not-idle"],
    [
      "bad-wchan",
      "tid=10 state=idle wchan=io_schedule\n",
      "node-proper-level5-native-thread-wchan-unsupported",
    ],
    ["empty", "", "node-proper-level5-native-thread-set-empty"],
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
      threadIndex: result.refusal.threadIndex,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-native-full-thread-set-verifier-summary",
    proof: "116",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      nativeFullThreadSetVerifierRan: true,
      allThreadsIdleAccepted: accepted.threadCount === 2,
      unsafeThreadsRefuseBeforeTargetStart: refusedRows.every((row) => row.targetStarted === false),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_116_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/116/checked-summary.json is stale; rerun with UPDATE_PROOF_116_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ threads: accepted.threadCount, refused: refusedRows.length }));
  console.log("proof 116 native full-thread-set verifier passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
