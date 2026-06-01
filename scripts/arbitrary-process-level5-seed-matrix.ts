import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyArbitraryProcessLevel5SeedReport,
  writeArbitraryProcessLevel5SeedReport,
} from "../packages/runtime/src/arbitrary-process-level5-seed-matrix.ts";

type Summary = {
  kind: "machinen.arbitrary-process-level5-seed-summary";
  accepted: boolean;
  outDir: string;
  reportPath: string;
  rowCount: number;
  artifactCount: number;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateArbitraryProcessCrossArchRestoreClaimed: 1;
  claimChangeAllowed: false;
  arbitraryProcessClaimed: false;
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = generate(options.outDir);
  process.stdout.write(
    options.json ? `${JSON.stringify(summary, null, 2)}\n` : `wrote ${summary.reportPath}\n`,
  );
}

export function generate(outDir: string): Summary {
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "arbitrary-process-level5-seed-report.json");
  const report = writeArbitraryProcessLevel5SeedReport({ outDir, path: reportPath });
  const verification = verifyArbitraryProcessLevel5SeedReport(report);
  const summary: Summary = {
    kind: "machinen.arbitrary-process-level5-seed-summary",
    accepted: verification.accepted,
    outDir,
    reportPath,
    rowCount: verification.rowCount,
    artifactCount: verification.artifactCount,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateArbitraryProcessCrossArchRestoreClaimed: 1,
    claimChangeAllowed: false,
    arbitraryProcessClaimed: false,
  };
  writeFileSync(
    join(outDir, "arbitrary-process-level5-seed-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  const outDir = valueAfterFlag(args, "--out");
  if (!outDir) {
    throw new Error("usage: arbitrary-process-level5-seed-matrix --out <dir> [--json]");
  }
  return { outDir, json: args.includes("--json") };
}

function valueAfterFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1]?.endsWith("arbitrary-process-level5-seed-matrix.ts")) {
  main();
}
