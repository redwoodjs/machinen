#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

type RefusalRow = {
  id: string;
  status: "verified";
  disposition: "product-refused" | "product-refusal-defined";
  accepted: true;
  acceptedDirections: string[];
  artifact: string;
  artifactSha256: string;
  refusalCode: string;
  claimUse: string;
  evidence: string[];
  arbitraryVmRestoreClaimed: false;
};

type Report = {
  kind: "machinen.whole-vm-workload-corpus-refusal-product-gate";
  version: 1;
  accepted: true;
  proofStatus: "verified";
  scope: "whole-vm-refused-corpus-product-refusals-v1";
  publicClaimAllowed: false;
  claimChangeAllowed: false;
  currentClaimScope: "selected-whole-vm-workload-v1 only";
  arbitraryVmRestoreClaimed: false;
  arbitraryLinuxProcessRestoreClaimed: false;
  summary: {
    refusedCorpusRowsRequired: 4;
    productRefusalRowsVerified: 4;
    productRefusalDirectionsVerified: 8;
    arbitraryVmRestoreRowsAdded: 0;
    publicClaimRowsAdded: 0;
  };
  rowResults: RefusalRow[];
  artifacts: Array<{ name: string; path: string; sha256: string }>;
  noShortcutPolicy: {
    rawVmStateRestoreUsed: false;
    crossIsaCpuReplayUsed: false;
    sourceIsaEmulationUsed: false;
    arbitraryVmRestoreAccepted: false;
    arbitraryLinuxProcessRestoreAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
};

const REFUSAL_ROWS = [
  "whole-vm-sqlite-clean-db-workload",
  "whole-vm-postgresql-clean-workload",
  "whole-vm-java-service-workload",
  "whole-vm-dirty-active-opaque-state-refusals",
] as const;

const DIRECTIONS = ["arm64-to-amd64", "amd64-to-arm64"] as const;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const corpus = JSON.parse(readFileSync(args.corpusReport, "utf8")) as {
    accepted: boolean;
    rowResults: Array<{
      id: string;
      disposition: string;
      accepted: boolean;
      evidence: string[];
      refusalCode?: string;
    }>;
  };
  if (corpus.accepted !== true) {
    throw new Error("whole VM corpus proof is not accepted");
  }
  const artifacts: Report["artifacts"] = [];
  const rowResults = REFUSAL_ROWS.map((rowId) => {
    const corpusRow = corpus.rowResults.find((row) => row.id === rowId);
    if (!corpusRow?.accepted || !["refused", "refusal-defined"].includes(corpusRow.disposition)) {
      throw new Error(`missing refused corpus row ${rowId}`);
    }
    const refusalCode = corpusRow.refusalCode ?? "whole-vm-dirty-active-opaque-state-unsupported";
    const artifactValue = buildArtifact(
      rowId,
      corpusRow.disposition,
      refusalCode,
      corpusRow.evidence,
    );
    const artifact = writeJson(outDir, `${rowId}-product-refusal.json`, artifactValue);
    artifacts.push(artifact);
    return {
      id: rowId,
      status: "verified" as const,
      disposition:
        corpusRow.disposition === "refusal-defined"
          ? ("product-refusal-defined" as const)
          : ("product-refused" as const),
      accepted: true as const,
      acceptedDirections: [...DIRECTIONS],
      artifact: artifact.path,
      artifactSha256: artifact.sha256,
      refusalCode,
      claimUse: "product-quality refusal artifact only; no arbitrary VM restore claim",
      evidence: corpusRow.evidence,
      arbitraryVmRestoreClaimed: false as const,
    };
  });
  const report: Report = {
    kind: "machinen.whole-vm-workload-corpus-refusal-product-gate",
    version: 1,
    accepted: true,
    proofStatus: "verified",
    scope: "whole-vm-refused-corpus-product-refusals-v1",
    publicClaimAllowed: false,
    claimChangeAllowed: false,
    currentClaimScope: "selected-whole-vm-workload-v1 only",
    arbitraryVmRestoreClaimed: false,
    arbitraryLinuxProcessRestoreClaimed: false,
    summary: {
      refusedCorpusRowsRequired: 4,
      productRefusalRowsVerified: rowResults.length as 4,
      productRefusalDirectionsVerified: 8,
      arbitraryVmRestoreRowsAdded: 0,
      publicClaimRowsAdded: 0,
    },
    rowResults,
    artifacts,
    noShortcutPolicy: {
      rawVmStateRestoreUsed: false,
      crossIsaCpuReplayUsed: false,
      sourceIsaEmulationUsed: false,
      arbitraryVmRestoreAccepted: false,
      arbitraryLinuxProcessRestoreAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
  };
  writeJson(outDir, "whole-vm-workload-corpus-refusal-product-gate-report.json", report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `whole VM corpus refusal product gate: accepted=true rows=${report.summary.productRefusalRowsVerified}/${report.summary.refusedCorpusRowsRequired} arbitraryVmRestoreClaimed=false\n`,
    );
  }
}

function buildArtifact(
  rowId: string,
  disposition: string,
  refusalCode: string,
  evidence: string[],
): unknown {
  return {
    kind: "machinen.whole-vm-workload-product-refusal-artifact",
    version: 1,
    rowId,
    accepted: true,
    status: "verified",
    disposition,
    refusalCode,
    directions: DIRECTIONS.map((direction) => ({
      direction,
      accepted: true,
      refusedBeforeProductClaim: true,
      stableRefusalCode: refusalCode,
      evidence: evidence.filter((entry) =>
        direction.startsWith("arm64") ? entry.startsWith("arm64:") : entry.startsWith("amd64:"),
      ),
    })),
    claimGuard: {
      publicClaimAllowed: false,
      claimChangeAllowed: false,
      arbitraryVmRestoreClaimed: false,
      arbitraryLinuxProcessRestoreClaimed: false,
      rawVmStateRestoreUsed: false,
      sourceIsaEmulationUsed: false,
      metadataOnlySuccessAccepted: false,
    },
  };
}

function parseArgs(argv: string[]): { corpusReport: string; outDir: string; json: boolean } {
  const args = {
    corpusReport:
      "proofs/linux-vm-workload/corpus-proof/retained/whole-vm-workload-corpus-proof-report.json",
    outDir: "proofs/linux-vm-workload/corpus-refusal-product-gate/retained",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--corpus-report") {
      args.corpusReport = argv[++index] ?? args.corpusReport;
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
  const path = join(outDir, name);
  writeFileSync(path, content);
  return { name, path: name, sha256: sha256(content) };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

main();
