import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PostgresRealCrossArchE2eGateReport = {
  kind: "machinen.postgres-real-cross-arch-e2e-gate-report";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  publicClaimAllowed: false;
  publicClaim: {
    productSupport: 0;
    broadSupport: 0;
    arbitraryProcessCrossArchRestore: 0;
  };
  retainedRealE2eDirections: Array<{ direction: string; retained: boolean; missing: string[] }>;
  logicalFixtureClaimBearing: false;
  noShortcutPolicy: {
    userSuppliedDumpAcceptedAsProductProof: false;
    physicalDataDirCopyAccepted: false;
    sourceIsaEmulationAccepted: false;
    sidecarRuntimeAccepted: false;
    appHooksAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
  blockers: string[];
};

const directions = ["amd64-to-arm64", "arm64-to-amd64"];
const requiredFiles = [
  "source/product-command.txt",
  "source/source-psql-transcript.txt",
  "source/snapshot.json",
  "target/product-command.txt",
  "target/restore.json",
  "target/target-psql-verifier.txt",
  "target/verifier.json",
];

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildPostgresRealCrossArchE2eGateReport(options.root);
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `postgres real cross-arch E2E gate: publicClaimAllowed=${report.publicClaimAllowed} blockers=${report.blockers.length}\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

export function buildPostgresRealCrossArchE2eGateReport(
  root: string,
): PostgresRealCrossArchE2eGateReport {
  const resolvedRoot = resolve(root);
  const retainedBase = join(resolvedRoot, "proofs/postgres/real-cross-arch-e2e-gate/retained");
  const retainedRealE2eDirections = directions.map((direction) => {
    const missing = requiredFiles.filter(
      (file) => !existsSync(join(retainedBase, direction, file)),
    );
    return { direction, retained: missing.length === 0, missing };
  });
  const logicalFixtureReport = join(
    resolvedRoot,
    "proofs/postgres/20-0-0/retained/postgres-claim-ladder-report.json",
  );
  const blockers = [
    "no retained real PostgreSQL no-dump amd64-to-arm64 product E2E artifacts",
    "no retained real PostgreSQL no-dump arm64-to-amd64 product E2E artifacts",
    "logical descriptor fixture is not claim-bearing for no-dump machinen snapshot/restore",
    "active sessions, active transactions, dirty WAL, physical data-dir copy, source ISA emulation, sidecars, app hooks, and metadata-only success remain refusal boundaries",
  ];
  const report = {
    kind: "machinen.postgres-real-cross-arch-e2e-gate-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted:
      existsSync(logicalFixtureReport) && retainedRealE2eDirections.every((row) => !row.retained),
    publicClaimAllowed: false,
    publicClaim: {
      productSupport: 0,
      broadSupport: 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    retainedRealE2eDirections,
    logicalFixtureClaimBearing: false,
    noShortcutPolicy: {
      userSuppliedDumpAcceptedAsProductProof: false,
      physicalDataDirCopyAccepted: false,
      sourceIsaEmulationAccepted: false,
      sidecarRuntimeAccepted: false,
      appHooksAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
    blockers,
  } satisfies PostgresRealCrossArchE2eGateReport;
  return report;
}

function parseArgs(args: string[]): { root: string; out?: string; json: boolean } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "../../..");
  const parsed: { root: string; out?: string; json: boolean } = { root: repoRoot, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--root") {
      parsed.root = takeValue(args, ++index, arg);
      continue;
    }
    if (arg === "--out") {
      parsed.out = takeValue(args, ++index, arg);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
