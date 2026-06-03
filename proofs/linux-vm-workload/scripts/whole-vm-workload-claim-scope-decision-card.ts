#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type Report = {
  kind: "machinen.whole-vm-workload-claim-scope-decision-card";
  version: 1;
  accepted: true;
  status: "verified";
  scope: "whole-vm-corpus-claim-scope-decision-v1";
  recommendation: "keep-current-public-claim-scope";
  publicClaimChangeAllowed: false;
  currentClaim: { productSupport: 100; broadSupport: 100; arbitraryProcessCrossArchRestore: 0 };
  currentClaimScope: "selected-whole-vm-workload-v1 only";
  productGatedRows: string[];
  productRefusedRows: string[];
  decisionReasons: string[];
  requiredBeforeBroaderClaim: string[];
  noShortcutPolicy: {
    rawVmStateRestoreAccepted: false;
    crossIsaCpuReplayAccepted: false;
    sourceIsaEmulationAccepted: false;
    arbitraryVmRestoreAccepted: false;
    arbitraryLinuxProcessRestoreAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
  artifacts: Array<{ name: string; path: string; sha256: string }>;
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const supported = JSON.parse(readFileSync(args.supportedReport, "utf8")) as {
    accepted: boolean;
    rowResults: Array<{ id: string }>;
    currentClaim: Report["currentClaim"];
    currentClaimScope: Report["currentClaimScope"];
  };
  const refused = JSON.parse(readFileSync(args.refusalReport, "utf8")) as {
    accepted: boolean;
    rowResults: Array<{ id: string }>;
  };
  if (supported.accepted !== true || refused.accepted !== true) {
    throw new Error("decision card requires accepted product/refusal gates");
  }
  const productGatedRows = supported.rowResults.map((row) => row.id);
  const productRefusedRows = refused.rowResults.map((row) => row.id);
  const report: Report = {
    kind: "machinen.whole-vm-workload-claim-scope-decision-card",
    version: 1,
    accepted: true,
    status: "verified",
    scope: "whole-vm-corpus-claim-scope-decision-v1",
    recommendation: "keep-current-public-claim-scope",
    publicClaimChangeAllowed: false,
    currentClaim: supported.currentClaim,
    currentClaimScope: supported.currentClaimScope,
    productGatedRows,
    productRefusedRows,
    decisionReasons: [
      "Supported broader-corpus rows have retained product-gate artifacts, but refused neighbors still bound the corpus.",
      "The product-gated corpus rows are selected workload rows, not arbitrary VM restore evidence.",
      "Raw VM-state replay, cross-ISA vCPU replay, source ISA emulation, and metadata-only success remain forbidden.",
      "Public claim language remains scoped to selected-whole-vm-workload-v1 until an explicit broader claim card is approved.",
    ],
    requiredBeforeBroaderClaim: [
      "explicit named workload scope",
      "retained product gates for every supported row in that scope",
      "retained product refusal artifacts for dirty/active/opaque neighbors",
      "dashboard/public documentation that says arbitrary VM restore is not claimed",
    ],
    noShortcutPolicy: {
      rawVmStateRestoreAccepted: false,
      crossIsaCpuReplayAccepted: false,
      sourceIsaEmulationAccepted: false,
      arbitraryVmRestoreAccepted: false,
      arbitraryLinuxProcessRestoreAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
    artifacts: [],
  };
  const artifact = writeJson(outDir, "whole-vm-workload-claim-scope-decision-card.json", report);
  report.artifacts = [artifact];
  writeJson(outDir, "whole-vm-workload-claim-scope-decision-card-report.json", report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `whole VM decision card: recommendation=${report.recommendation} publicClaimChangeAllowed=false\n`,
    );
  }
}

function parseArgs(argv: string[]): {
  supportedReport: string;
  refusalReport: string;
  outDir: string;
  json: boolean;
} {
  const args = {
    supportedReport:
      "proofs/linux-vm-workload/corpus-product-gate/retained/whole-vm-workload-corpus-product-gate-report.json",
    refusalReport:
      "proofs/linux-vm-workload/corpus-refusal-product-gate/retained/whole-vm-workload-corpus-refusal-product-gate-report.json",
    outDir: "proofs/linux-vm-workload/claim-scope-decision-card/retained",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--supported-report") {
      args.supportedReport = argv[++index] ?? args.supportedReport;
    } else if (arg === "--refusal-report") {
      args.refusalReport = argv[++index] ?? args.refusalReport;
    } else if (arg === "--out") {
      args.outDir = argv[++index] ?? args.outDir;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function writeJson(
  outDir: string,
  name: string,
  value: unknown,
): { name: string; path: string; sha256: string } {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(outDir, name), content);
  return { name, path: name, sha256: createHash("sha256").update(content).digest("hex") };
}

main();
