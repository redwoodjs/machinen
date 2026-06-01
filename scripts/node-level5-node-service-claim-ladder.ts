import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  verifyNodeLevel5NodeServiceClaimLadderReport,
  writeNodeLevel5NodeServiceClaimLadderReport,
} from "../packages/runtime/src/node-level5-node-service-claim-ladder.ts";

type Summary = {
  kind: "machinen.node-level5-node-service-claim-ladder-summary";
  accepted: boolean;
  outDir: string;
  reportPath: string;
  tierCount: number;
  artifactCount: number;
  finalNodeProductSupportClaimed: 100;
  finalBroadNodeProductSupportClaimed: 100;
  finalArbitraryProcessCrossArchRestoreClaimed: 0;
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
  const reportPath = join(outDir, "node-level5-node-service-claim-ladder-report.json");
  const report = writeNodeLevel5NodeServiceClaimLadderReport({ outDir, path: reportPath });
  const verification = verifyNodeLevel5NodeServiceClaimLadderReport(report);
  const summary: Summary = {
    kind: "machinen.node-level5-node-service-claim-ladder-summary",
    accepted: verification.accepted,
    outDir,
    reportPath,
    tierCount: verification.tierCount,
    artifactCount: verification.artifactCount,
    finalNodeProductSupportClaimed: 100,
    finalBroadNodeProductSupportClaimed: 100,
    finalArbitraryProcessCrossArchRestoreClaimed: 0,
  };
  writeFileSync(
    join(outDir, "node-level5-node-service-claim-ladder-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  return summary;
}

function parseArgs(args: string[]): { outDir: string; json: boolean } {
  const outDir = valueAfterFlag(args, "--out");
  if (!outDir) {
    throw new Error("usage: node-level5-node-service-claim-ladder --out <dir> [--json]");
  }
  return { outDir, json: args.includes("--json") };
}

function valueAfterFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1]?.endsWith("node-level5-node-service-claim-ladder.ts")) {
  main();
}
