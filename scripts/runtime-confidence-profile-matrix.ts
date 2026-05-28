#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildRuntimeConfidenceProfileMatrix } from "../packages/runtime/src/index.ts";

const argv = process.argv.slice(2);
const json = argv.includes("--json");
const summaryIndex = argv.indexOf("--summary");
const summaryPath = summaryIndex === -1 ? undefined : argv[summaryIndex + 1];
const acceptedArgs = new Set(["--json", "--summary", summaryPath]);
if (argv.some((arg) => !acceptedArgs.has(arg)) || summaryPath?.startsWith("--")) {
  console.error(
    "usage: tsx scripts/runtime-confidence-profile-matrix.ts [--json] [--summary file]",
  );
  process.exit(2);
}

const summary = buildRuntimeConfidenceProfileMatrix();
const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
if (summaryPath) {
  writeFileSync(resolve(summaryPath), summaryText);
}
if (json) {
  process.stdout.write(summaryText);
} else {
  process.stdout.write(
    `runtime-confidence-profile-matrix: ${summary.state} rows=${summary.rowCount} c=${summary.byRuntime.c} java=${summary.byRuntime.java} refused=${summary.byClassification.refused}\n`,
  );
}
process.exit(summary.pass ? 0 : 1);
