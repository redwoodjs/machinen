#!/usr/bin/env tsx
import { resolve } from "node:path";

import {
  createArbitraryProcessLevel5IdleResourceProof,
  verifyArbitraryProcessLevel5IdleResourceProofReport,
} from "../../../packages/runtime/src/arbitrary-process-level5-idle-resource-proof.ts";

type Args = { outDir: string; json: boolean };
function parseArgs(argv: string[]): Args {
  const args: Args = { outDir: "idle-resource-proof", json: false };
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
const report = verifyArbitraryProcessLevel5IdleResourceProofReport(
  createArbitraryProcessLevel5IdleResourceProof({ outDir: resolve(args.outDir) }),
);
if (args.json) {
  console.log(JSON.stringify(report));
} else {
  console.log(`idle resource proof accepted=${report.accepted}`);
}
if (!report.accepted) {
  process.exitCode = 1;
}
