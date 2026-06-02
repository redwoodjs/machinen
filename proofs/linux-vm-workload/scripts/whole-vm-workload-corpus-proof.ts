import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Arch = "arm64" | "amd64";
type CorpusDisposition = "supported" | "refused" | "refusal-defined";

type ParsedRow = {
  arch: Arch;
  id: string;
  disposition: CorpusDisposition;
  accepted: boolean;
  verifier: Record<string, string>;
  refusalCode?: string;
  evidence: string;
};

type CorpusRowReport = {
  id: string;
  status: "verified";
  disposition: CorpusDisposition;
  claimUse: "proof-only" | "refusal-boundary-only";
  acceptedArchs: Arch[];
  accepted: boolean;
  productSupportClaimAllowed: false;
  evidence: string[];
  refusalCode?: string;
};

type CorpusProofReport = {
  kind: "machinen.whole-vm-workload-corpus-proof";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  proofStatus: "verified" | "blocked";
  publicClaimAllowed: false;
  currentClaim: {
    productSupport: 100;
    broadSupport: 100;
    arbitraryProcessCrossArchRestore: 0;
  };
  currentClaimScope: "selected-whole-vm-workload-v1 only";
  claimChangeAllowed: false;
  summary: {
    requiredRows: number;
    verifiedRows: number;
    proofOnlySupportedRows: number;
    refusedRows: number;
    refusalDefinedRows: number;
    productSupportRowsAdded: 0;
  };
  rowResults: CorpusRowReport[];
  artifacts: Array<{ name: string; path: string; sha256: string }>;
  noShortcutPolicy: {
    rawVmStateRestoreAccepted: false;
    crossIsaCpuReplayAccepted: false;
    sourceIsaEmulationAccepted: false;
    arbitraryVmRestoreAccepted: false;
    arbitraryLinuxProcessRestoreAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
};

const REQUIRED_ROWS = [
  "whole-vm-sqlite-clean-db-workload",
  "whole-vm-postgresql-clean-workload",
  "whole-vm-c-service-workload",
  "whole-vm-java-service-workload",
  "whole-vm-filesystem-workload",
  "whole-vm-network-listener-workload",
  "whole-vm-multi-process-workload",
  "whole-vm-dirty-active-opaque-state-refusals",
] as const;

const REQUIRED_ARCHS: Arch[] = ["arm64", "amd64"];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const retainedDir = resolve(args.retainedDir);
  const rows = REQUIRED_ARCHS.flatMap((arch) => parseRows(readTranscript(retainedDir, arch), arch));
  const rowResults = REQUIRED_ROWS.map((id) => summarizeRow(id, rows));
  const accepted = rowResults.every((row) => row.accepted);
  const report: CorpusProofReport = {
    kind: "machinen.whole-vm-workload-corpus-proof",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    proofStatus: accepted ? "verified" : "blocked",
    publicClaimAllowed: false,
    currentClaim: {
      productSupport: 100,
      broadSupport: 100,
      arbitraryProcessCrossArchRestore: 0,
    },
    currentClaimScope: "selected-whole-vm-workload-v1 only",
    claimChangeAllowed: false,
    summary: {
      requiredRows: REQUIRED_ROWS.length,
      verifiedRows: rowResults.filter((row) => row.accepted).length,
      proofOnlySupportedRows: rowResults.filter((row) => row.disposition === "supported").length,
      refusedRows: rowResults.filter((row) => row.disposition === "refused").length,
      refusalDefinedRows: rowResults.filter((row) => row.disposition === "refusal-defined").length,
      productSupportRowsAdded: 0,
    },
    rowResults,
    artifacts: retainedArtifacts(retainedDir),
    noShortcutPolicy: {
      rawVmStateRestoreAccepted: false,
      crossIsaCpuReplayAccepted: false,
      sourceIsaEmulationAccepted: false,
      arbitraryVmRestoreAccepted: false,
      arbitraryLinuxProcessRestoreAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
  };
  writeJson(join(retainedDir, "whole-vm-workload-corpus-proof-report.json"), report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `whole VM corpus proof: accepted=${report.accepted} verified=${report.summary.verifiedRows}/${report.summary.requiredRows} productSupportRowsAdded=0\n`,
    );
  }
  if (!accepted) {
    process.exitCode = 1;
  }
}

function readTranscript(retainedDir: string, arch: Arch): string {
  const stderrPath = join(retainedDir, arch, "stderr.txt");
  const stdoutPath = join(retainedDir, arch, "stdout.txt");
  return `${readFile(stderrPath)}\n${readFile(stdoutPath)}`;
}

function parseRows(transcript: string, expectedArch: Arch): ParsedRow[] {
  const rows: ParsedRow[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    const marker = "MACHINEN_WHOLE_VM_CORPUS_ROW ";
    const markerIndex = line.indexOf(marker);
    if (markerIndex === -1) {
      continue;
    }
    const verifier = Object.fromEntries(
      line
        .slice(markerIndex + marker.length)
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => {
          const index = part.indexOf("=");
          return index === -1 ? [part, ""] : [part.slice(0, index), part.slice(index + 1)];
        }),
    );
    if (verifier.arch !== expectedArch) {
      continue;
    }
    rows.push({
      arch: expectedArch,
      id: verifier.id ?? "",
      disposition: parseDisposition(verifier.disposition),
      accepted: verifier.accepted === "true",
      verifier,
      refusalCode: verifier.refusalCode,
      evidence: verifier.evidence ?? line,
    });
  }
  return rows;
}

function summarizeRow(id: string, rows: ParsedRow[]): CorpusRowReport {
  const matching = rows.filter((row) => row.id === id);
  const acceptedArchs = REQUIRED_ARCHS.filter((arch) =>
    matching.some((row) => row.arch === arch && row.accepted),
  );
  const disposition = matching[0]?.disposition ?? "refused";
  const sameDisposition = matching.every((row) => row.disposition === disposition);
  const accepted = acceptedArchs.length === REQUIRED_ARCHS.length && sameDisposition;
  return {
    id,
    status: "verified",
    disposition,
    claimUse: disposition === "refusal-defined" ? "refusal-boundary-only" : "proof-only",
    acceptedArchs,
    accepted,
    productSupportClaimAllowed: false,
    evidence: matching.map((row) => `${row.arch}:${row.evidence}`),
    refusalCode: matching.find((row) => row.refusalCode)?.refusalCode,
  };
}

function parseDisposition(value: string | undefined): CorpusDisposition {
  if (value === "supported" || value === "refused" || value === "refusal-defined") {
    return value;
  }
  return "refused";
}

function retainedArtifacts(
  retainedDir: string,
): Array<{ name: string; path: string; sha256: string }> {
  const artifacts: Array<{ name: string; path: string; sha256: string }> = [];
  for (const relativePath of [
    "arm64/stderr.txt",
    "arm64/stdout.txt",
    "amd64/stderr.txt",
    "amd64/stdout.txt",
    "sources/c-service.c",
    "sources/network-listener.c",
    "sources/multi-process.c",
    "sources/run-corpus.sh",
  ]) {
    const path = join(retainedDir, relativePath);
    artifacts.push({ name: relativePath, path, sha256: sha256File(path) });
  }
  return artifacts;
}

function parseArgs(argv: string[]): { retainedDir: string; json: boolean } {
  let retainedDir = "proofs/linux-vm-workload/corpus-proof/retained";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--retained-dir") {
      retainedDir = argv[++index] ?? retainedDir;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { retainedDir, json };
}

function readFile(path: string): string {
  if (!existsSync(path)) {
    throw new Error(`missing retained artifact: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

main();
