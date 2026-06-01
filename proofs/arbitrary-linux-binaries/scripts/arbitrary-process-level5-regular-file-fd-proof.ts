#!/usr/bin/env tsx

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createArbitraryProcessLevel5RegularFileFdProof } from "../../../packages/runtime/src/arbitrary-process-level5-regular-file-fd-proof.ts";

function main(): void {
  const out = valueAfter("--out");
  const json = process.argv.includes("--json");
  if (!out) {
    throw new Error("usage: arbitrary-process-level5-regular-file-fd-proof --out <dir> [--json]");
  }
  const outDir = resolve(out);
  mkdirSync(outDir, { recursive: true });
  const report = createArbitraryProcessLevel5RegularFileFdProof({ outDir });
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `arbitrary process regular file FD proof ${report.accepted ? "accepted" : "rejected"}: ${outDir}\n`,
  );
}

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

main();
