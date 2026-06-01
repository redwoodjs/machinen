#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_REPORT,
  createProductPortablePostgresClaimLadderReport,
  verifyProductPortablePostgresClaimLadderReport,
} from "../../../packages/runtime/src/product-portable-postgres-claim-ladder.ts";

type Args = { outDir: string; json: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { outDir: "postgres-claim-ladder", json: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      args.outDir = argv[++index] ?? args.outDir;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv);
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const report = verifyProductPortablePostgresClaimLadderReport(
    createProductPortablePostgresClaimLadderReport({ outDir }),
  );
  writeFileSync(`${outDir}/summary.json`, `${JSON.stringify(report, null, 2)}\n`);
  if (args.json) {
    console.log(JSON.stringify(report));
  } else {
    console.log(
      `Postgres claim ladder ${report.currentClaim.productSupport} / ${report.currentClaim.broadSupport} / ${report.currentClaim.arbitraryProcessCrossArchRestore} accepted=${report.accepted} report=${outDir}/${PRODUCT_PORTABLE_POSTGRES_CLAIM_LADDER_REPORT}`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

main();
