import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RetainedPostgresRowProof = {
  rowId: string;
  direction: string;
  accepted: boolean;
  path: string;
};

type PostgresRealCrossArchE2eGateReport = {
  kind: "machinen.postgres-real-cross-arch-e2e-gate-report";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  publicClaimAllowed: boolean;
  publicClaim: {
    productSupport: 0 | 100;
    broadSupport: 0 | 100;
    arbitraryProcessCrossArchRestore: 0;
  };
  retainedRealE2eDirections: Array<{
    direction: string;
    retained: boolean;
    accepted: boolean;
    missing: string[];
    verifierAccepted: boolean;
    noUserSuppliedDump: boolean;
    targetVerifierOutputFileNotUsed: boolean;
    rowProofsAccepted: boolean;
  }>;
  retainedRowProofs: RetainedPostgresRowProof[];
  logicalCrossArchPsqlProof: {
    retained: boolean;
    accepted: boolean;
    claimBearingForNoDumpMachinenProduct: false;
    path: string;
  };
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
const requiredRowProofIds = [
  "postgresql-psql-query-workload-e2e",
  "postgresql-schema-data-query-e2e",
  "postgresql-role-permission-e2e",
  "postgresql-unix-pg-isready-command",
  "postgresql-unix-psql-command",
  "postgresql-unix-createdb-dropdb-command",
];

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
    const verifierPath = join(retainedBase, direction, "target/verifier.json");
    const verifier = existsSync(verifierPath)
      ? (JSON.parse(readFileSync(verifierPath, "utf8")) as {
          accepted?: boolean;
          noUserSuppliedDump?: boolean;
          targetVerifierOutputFileNotUsed?: boolean;
          sourceIsaEmulationUsed?: boolean;
          sidecarRuntimeUsed?: boolean;
          appHooksRequired?: boolean;
          metadataOnlyShortcutAccepted?: boolean;
          rowProofs?: Array<{ rowId: string; accepted: boolean; path: string }>;
        })
      : undefined;
    const verifierAccepted = verifier?.accepted === true;
    const noUserSuppliedDump = verifier?.noUserSuppliedDump === true;
    const targetVerifierOutputFileNotUsed = verifier?.targetVerifierOutputFileNotUsed === true;
    const rowProofsAccepted = requiredRowProofIds.every((rowId) =>
      verifier?.rowProofs?.some((row) => row.rowId === rowId && row.accepted === true),
    );
    const accepted =
      missing.length === 0 &&
      verifierAccepted &&
      noUserSuppliedDump &&
      targetVerifierOutputFileNotUsed &&
      rowProofsAccepted &&
      verifier?.sourceIsaEmulationUsed === false &&
      verifier?.sidecarRuntimeUsed === false &&
      verifier?.appHooksRequired === false &&
      verifier?.metadataOnlyShortcutAccepted === false;
    return {
      direction,
      retained: missing.length === 0,
      accepted,
      missing,
      verifierAccepted,
      noUserSuppliedDump,
      targetVerifierOutputFileNotUsed,
      rowProofsAccepted,
    };
  });
  const retainedRowProofs = directions.flatMap((direction) =>
    requiredRowProofIds.map((rowId) => retainedRowProof(retainedBase, direction, rowId)),
  );
  const logicalFixtureReport = join(
    resolvedRoot,
    "proofs/postgres/20-0-0/retained/postgres-claim-ladder-report.json",
  );
  const logicalCrossArchPsqlProofPath = join(
    resolvedRoot,
    "proofs/postgres/cross-arch-logical-psql-restore/retained/postgres-cross-arch-logical-psql-restore-gate-report.json",
  );
  const logicalCrossArchPsqlProofReport = existsSync(logicalCrossArchPsqlProofPath)
    ? (JSON.parse(readFileSync(logicalCrossArchPsqlProofPath, "utf8")) as { accepted?: boolean })
    : undefined;
  const blockers = retainedRealE2eDirections.every((row) => row.accepted)
    ? [
        "claim is scoped to clean quiesced PostgreSQL product capture/restore only; active sessions, active transactions, dirty WAL, physical data-dir copy, source ISA emulation, sidecars, app hooks, and metadata-only success remain refusal boundaries",
      ]
    : [
        "no retained real PostgreSQL no-dump amd64-to-arm64 product E2E artifacts",
        "no retained real PostgreSQL no-dump arm64-to-amd64 product E2E artifacts",
        "logical descriptor fixture is not claim-bearing for no-dump machinen snapshot/restore",
        "active sessions, active transactions, dirty WAL, physical data-dir copy, source ISA emulation, sidecars, app hooks, and metadata-only success remain refusal boundaries",
      ];
  const publicClaimAllowed = retainedRealE2eDirections.every((row) => row.accepted);
  const report = {
    kind: "machinen.postgres-real-cross-arch-e2e-gate-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted:
      existsSync(logicalFixtureReport) && retainedRealE2eDirections.every((row) => row.accepted),
    publicClaimAllowed,
    publicClaim: {
      productSupport: publicClaimAllowed ? 100 : 0,
      broadSupport: publicClaimAllowed ? 100 : 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    retainedRealE2eDirections,
    retainedRowProofs,
    logicalCrossArchPsqlProof: {
      retained: existsSync(logicalCrossArchPsqlProofPath),
      accepted: logicalCrossArchPsqlProofReport?.accepted === true,
      claimBearingForNoDumpMachinenProduct: false,
      path: "proofs/postgres/cross-arch-logical-psql-restore/retained/postgres-cross-arch-logical-psql-restore-gate-report.json",
    },
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

function retainedRowProof(
  base: string,
  direction: string,
  rowId: string,
): RetainedPostgresRowProof {
  const slugs: Record<string, string> = {
    "postgresql-psql-query-workload-e2e": "psql-query-workload",
    "postgresql-schema-data-query-e2e": "schema-data-query",
    "postgresql-role-permission-e2e": "role-permission",
    "postgresql-unix-pg-isready-command": "unix-pg-isready-command",
    "postgresql-unix-psql-command": "unix-psql-command",
    "postgresql-unix-createdb-dropdb-command": "unix-createdb-dropdb-command",
  };
  const path = join(base, direction, "row-proofs", slugs[rowId]!, "row-proof.json");
  const report = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as { accepted?: boolean })
    : undefined;
  return {
    rowId,
    direction,
    accepted: report?.accepted === true,
    path: path.replace(`${process.cwd()}/`, ""),
  };
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
