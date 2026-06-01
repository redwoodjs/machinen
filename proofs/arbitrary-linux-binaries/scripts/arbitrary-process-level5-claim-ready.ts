#!/usr/bin/env tsx
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  evaluateArbitraryProcessLevel5ClaimReady,
  writeArbitraryProcessLevel5ClaimReadyReport,
} from "../../../packages/runtime/src/arbitrary-process-level5-claim-ready.ts";
import { createArbitraryProcessLevel5RegularFileFdProof } from "../../../packages/runtime/src/arbitrary-process-level5-regular-file-fd-proof.ts";
import { createArbitraryProcessLevel5SeedReport } from "../../../packages/runtime/src/arbitrary-process-level5-seed-matrix.ts";
import { createArbitraryProcessLevel5SimplePipeFdProof } from "../../../packages/runtime/src/arbitrary-process-level5-simple-pipe-fd-proof.ts";

type Args = { outDir: string; json: boolean };

function parseArgs(argv: string[]): Args {
  const args: Args = { outDir: "arbitrary-process-claim-ready", json: false };
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
const outDir = resolve(args.outDir);
mkdirSync(outDir, { recursive: true });
const seedReport = createArbitraryProcessLevel5SeedReport({ outDir: join(outDir, "seed") });
const regularFile = createArbitraryProcessLevel5RegularFileFdProof({
  outDir: join(outDir, "regular-file-fd"),
});
const simplePipe = createArbitraryProcessLevel5SimplePipeFdProof({
  outDir: join(outDir, "simple-pipe-fd"),
});
const report = evaluateArbitraryProcessLevel5ClaimReady({
  seedReport,
  verifiedSeeds: [
    {
      rowId: regularFile.rowId,
      accepted: regularFile.accepted,
      proofStatus: regularFile.proofStatus,
      artifact: "regular-file-fd/regular-file-fd-proof-report.json",
      sha256: regularFile.artifactsSha256,
    },
    {
      rowId: simplePipe.rowId,
      accepted: simplePipe.accepted,
      proofStatus: simplePipe.proofStatus,
      artifact: "simple-pipe-fd/simple-pipe-fd-proof-report.json",
      sha256: simplePipe.artifactsSha256,
    },
  ],
});
writeArbitraryProcessLevel5ClaimReadyReport(outDir, report);
if (args.json) {
  console.log(JSON.stringify(report));
} else {
  console.log(
    `arbitrary-process claim-ready accepted=${report.accepted} claimChangeAllowed=${report.claimChangeAllowed} verifiedSeeds=${report.verifiedSeedCount}`,
  );
}
