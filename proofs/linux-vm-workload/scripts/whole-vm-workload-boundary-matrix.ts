import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Taxonomy = {
  kind: "machinen.whole-linux-vm-workload-taxonomy";
  version: 1;
  status: "definition-only";
  claimChangeAllowed: false;
  currentClaim: {
    productSupport: 0;
    broadSupport: 0;
    arbitraryProcessCrossArchRestore: 0;
  };
  taxonomy: Record<string, unknown>;
  supportedSubsetCandidate: {
    id: "selected-whole-vm-workload-v1";
    requiredSupportedRows: Array<{ id: string; requirement: string }>;
  };
  refusalBoundaries: Array<{
    id: string;
    expectedDisposition: string;
    reason: string;
  }>;
  artifactRequirements: {
    supportedDirection: string[];
    refusalDirection: string[];
    forbiddenShortcuts: string[];
  };
  dashboardClaimLanguage: Record<string, string>;
};

type BoundaryMatrixReport = {
  kind: "machinen.whole-vm-workload-boundary-matrix";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  proofStatus: "verified" | "not-started";
  publicClaimAllowed: false;
  currentClaim: {
    productSupport: 0;
    broadSupport: 0;
    arbitraryProcessCrossArchRestore: 0;
  };
  selectedSubset: "selected-whole-vm-workload-v1";
  supportedRows: Array<{
    id: string;
    status: "defined-not-proven";
    requirement: string;
    retainedProductArtifactRequired: true;
  }>;
  refusalRows: Array<{
    id: string;
    status: "defined-refusal-required";
    expectedDisposition: string;
    reason: string;
    retainedProductArtifactRequired: true;
  }>;
  artifactRequirements: Taxonomy["artifactRequirements"];
  forbiddenShortcuts: string[];
  acceptanceChecks: Record<string, boolean>;
  claimLanguage: Taxonomy["dashboardClaimLanguage"];
  taxonomyArtifact: {
    path: string;
    sha256: string;
  };
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const taxonomyPath = resolve(args.taxonomy);
  const taxonomy = JSON.parse(readFileSync(taxonomyPath, "utf8")) as Taxonomy;
  const checks = acceptanceChecks(taxonomy);
  const accepted = Object.values(checks).every(Boolean);
  const report: BoundaryMatrixReport = {
    kind: "machinen.whole-vm-workload-boundary-matrix",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    proofStatus: accepted ? "verified" : "not-started",
    publicClaimAllowed: false,
    currentClaim: {
      productSupport: 0,
      broadSupport: 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    selectedSubset: taxonomy.supportedSubsetCandidate.id,
    supportedRows: taxonomy.supportedSubsetCandidate.requiredSupportedRows.map((row) => ({
      id: row.id,
      status: "defined-not-proven",
      requirement: row.requirement,
      retainedProductArtifactRequired: true,
    })),
    refusalRows: taxonomy.refusalBoundaries.map((row) => ({
      id: row.id,
      status: "defined-refusal-required",
      expectedDisposition: row.expectedDisposition,
      reason: row.reason,
      retainedProductArtifactRequired: true,
    })),
    artifactRequirements: taxonomy.artifactRequirements,
    forbiddenShortcuts: taxonomy.artifactRequirements.forbiddenShortcuts,
    acceptanceChecks: checks,
    claimLanguage: taxonomy.dashboardClaimLanguage,
    taxonomyArtifact: {
      path: args.taxonomy,
      sha256: sha256File(taxonomyPath),
    },
  };
  const outDir = resolve(args.outDir);
  writeJson(join(outDir, "whole-vm-workload-boundary-matrix-report.json"), report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `whole VM workload boundary matrix: accepted=${report.accepted} supported=${report.supportedRows.length} refusals=${report.refusalRows.length}\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

function acceptanceChecks(taxonomy: Taxonomy): Record<string, boolean> {
  return {
    taxonomyKind: taxonomy.kind === "machinen.whole-linux-vm-workload-taxonomy",
    definitionOnly: taxonomy.status === "definition-only" && taxonomy.claimChangeAllowed === false,
    claimStaysZero:
      taxonomy.currentClaim.productSupport === 0 &&
      taxonomy.currentClaim.broadSupport === 0 &&
      taxonomy.currentClaim.arbitraryProcessCrossArchRestore === 0,
    selectedSubsetNamed: taxonomy.supportedSubsetCandidate.id === "selected-whole-vm-workload-v1",
    supportedRowsEnumerated: taxonomy.supportedSubsetCandidate.requiredSupportedRows.length >= 5,
    refusalBoundariesEnumerated: taxonomy.refusalBoundaries.length >= 8,
    supportedArtifactsRequired: taxonomy.artifactRequirements.supportedDirection.length >= 8,
    refusalArtifactsRequired: taxonomy.artifactRequirements.refusalDirection.length >= 4,
    forbiddenShortcutsEnumerated: requiredForbiddenShortcutsPresent(
      taxonomy.artifactRequirements.forbiddenShortcuts,
    ),
    dashboardLanguagePresent:
      typeof taxonomy.dashboardClaimLanguage.notStarted === "string" &&
      typeof taxonomy.dashboardClaimLanguage.futureIfProven === "string" &&
      typeof taxonomy.dashboardClaimLanguage.requiredBoundaryText === "string",
  };
}

function requiredForbiddenShortcutsPresent(shortcuts: string[]): boolean {
  return [
    "raw vCPU replay",
    "source ISA emulation",
    "opaque VM/device metadata-only success",
  ].every((required) => shortcuts.includes(required));
}

function parseArgs(argv: string[]): { taxonomy: string; outDir: string; json: boolean } {
  let taxonomy = "docs/snapshot/whole-linux-vm-workload-taxonomy.json";
  let outDir = "proofs/linux-vm-workload/boundary-matrix/retained";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--taxonomy") {
      taxonomy = argv[++index] ?? taxonomy;
    } else if (arg === "--out-dir") {
      outDir = argv[++index] ?? outDir;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { taxonomy, outDir, json };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

main();
