#!/usr/bin/env tsx
import { resolve } from "node:path";

import {
  createProductPortablePostgresClaimReadyReport,
  verifyProductPortablePostgresClaimReadyReport,
} from "../../../packages/runtime/src/product-portable-postgres-claim-ready.ts";

type Args = { outDir: string; json: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { outDir: "postgres-clean-logical-20-claim-ready", json: false };
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

const args = parseArgs(process.argv);
const report = verifyProductPortablePostgresClaimReadyReport(
  createProductPortablePostgresClaimReadyReport({ outDir: resolve(args.outDir) }),
);
if (args.json) {
  console.log(JSON.stringify(report));
} else {
  console.log(
    `postgres clean logical 20 claim-ready accepted=${report.accepted} candidate=${report.candidateClaim.productSupport}%`,
  );
}
if (!report.accepted) {
  process.exitCode = 1;
}
