import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Direction = "arm64-to-amd64" | "amd64-to-arm64";

type Artifact = { path: string; exists: boolean; bytes: number; sha256: string };
type Check = { id: string; passed: boolean; message: string };

type RouteVerification = {
  direction: Direction;
  accepted: boolean;
  sourceArch: string;
  targetArch: string;
  sourceHost: string;
  targetHost: string;
  sourcePostgresVersion: string;
  targetPostgresVersion: string;
  logicalFingerprint: string;
  dumpSha256: string;
  retainedDumpSha256: string;
  sourceVerifierOutputSha256: string;
  targetVerifierOutputSha256: string;
  checks: Check[];
};

type PostgresCrossArchLogicalPsqlRestoreGateReport = {
  kind: "machinen.postgres-cross-arch-logical-psql-restore-gate-report";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  verifiedScope: {
    runtime: "postgresql";
    interface: "psql";
    subset: "postgres-clean-quiesced-cross-arch-logical-restore";
    directions: Direction[];
    crossArchitecture: true;
    restoreMechanism: "target-native-logical-sql-restore";
    machinenNoDumpSnapshotRestore: false;
  };
  publicPortablePostgresClaimAllowed: false;
  publicClaim: {
    productSupport: 0;
    broadSupport: 0;
    arbitraryProcessCrossArchRestore: 0;
  };
  guarantees: string[];
  nonGuarantees: string[];
  routes: RouteVerification[];
  noShortcutPolicy: {
    physicalDataDirectoryPortable: false;
    sourceIsaEmulationUsed: false;
    sourceTextReplayAcceptedAsMachinenProductProof: false;
    sidecarRuntimeUsed: false;
    appHooksRequired: false;
    metadataOnlyShortcutAccepted: false;
    targetNativeExecutionRequired: true;
  };
  refusalBoundaries: string[];
  checks: Check[];
  artifacts: Artifact[];
};

const directions: Direction[] = ["arm64-to-amd64", "amd64-to-arm64"];
const perDirectionFiles = [
  "postgres.logical.sql",
  "route.json",
  "source-product-command.txt",
  "source-psql-transcript.txt",
  "target-product-command.txt",
  "target-psql-verifier.txt",
];

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildPostgresCrossArchLogicalPsqlRestoreGateReport(options.root);
  const retainedRoot = join(
    resolve(options.root),
    "proofs/postgres/cross-arch-logical-psql-restore/retained",
  );
  for (const route of report.routes) {
    const verifierPath = join(retainedRoot, route.direction, "verifier.json");
    writeFileSync(verifierPath, `${JSON.stringify(routeVerifier(route, report), null, 2)}\n`);
  }
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `postgres cross-arch logical psql restore gate: accepted=${report.accepted} routes=${report.routes.length}\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

export function buildPostgresCrossArchLogicalPsqlRestoreGateReport(
  root: string,
): PostgresCrossArchLogicalPsqlRestoreGateReport {
  const resolvedRoot = resolve(root);
  const retainedRoot = join(
    resolvedRoot,
    "proofs/postgres/cross-arch-logical-psql-restore/retained",
  );
  const summary = readJson(
    join(retainedRoot, "postgres-cross-arch-logical-psql-restore-summary.json"),
  ) as any;
  const artifacts = [
    artifact(join(retainedRoot, "postgres-cross-arch-logical-psql-restore-summary.json")),
    artifact(join(retainedRoot, "product-command.txt")),
    ...directions.flatMap((direction) =>
      perDirectionFiles.map((file) => artifact(join(retainedRoot, direction, file))),
    ),
  ];
  const routes = directions.map((direction) => routeVerification(retainedRoot, summary, direction));
  const checks: Check[] = [
    check(
      "summary-completed",
      summary?.state === "completed",
      "cross-arch logical proof completed",
    ),
    check("runtime-postgresql", summary?.runtime === "postgresql", "summary runtime is PostgreSQL"),
    check(
      "native-hosts",
      summary?.hosts?.arm64?.arch === "arm64" && summary?.hosts?.amd64?.arch === "amd64",
      "retained proof used native arm64 and native amd64 hosts",
    ),
    check(
      "route-count",
      summary?.postgres?.routeCount === 2 && routes.length === 2,
      "both arm64->amd64 and amd64->arm64 routes are retained",
    ),
    check(
      "bidirectional-cross-arch",
      summary?.supportedSubset?.bidirectionalArm64Amd64 === true &&
        routes.every((route) => route.sourceArch !== route.targetArch),
      "routes are bidirectional across arm64 and amd64",
    ),
    check(
      "target-native-logical-restore",
      routes.every((route) => route.checks.find((row) => row.id === "target-native")?.passed),
      "each route restored into target-native PostgreSQL",
    ),
    check(
      "source-target-verifier-match",
      routes.every(
        (route) => route.checks.find((row) => row.id === "source-target-verifier-match")?.passed,
      ),
      "source and target psql verifier output match in every route",
    ),
    check(
      "retained-dump-integrity",
      routes.every((route) => route.dumpSha256 === route.retainedDumpSha256),
      "retained logical SQL dump hashes match route summaries",
    ),
    check(
      "no-active-transactions",
      routes.every(
        (route) => route.checks.find((row) => row.id === "no-active-transactions")?.passed,
      ),
      "all captures had zero active PostgreSQL transactions",
    ),
    check(
      "no-shortcuts",
      summary?.securityInspection?.passed === true &&
        summary?.securityInspection?.sourceIsaEmulationArtifactFound === false &&
        summary?.securityInspection?.sidecarRuntimeArtifactFound === false &&
        summary?.securityInspection?.appHookArtifactFound === false &&
        summary?.securityInspection?.metadataOnlyShortcutAccepted === false,
      "no ISA emulation, sidecar, app hook, or metadata-only shortcut was accepted",
    ),
    check(
      "retained-artifacts-present",
      artifacts.every((entry) => entry.exists),
      "all required retained logical psql artifacts exist",
    ),
  ];
  const accepted = checks.every((row) => row.passed) && routes.every((route) => route.accepted);
  return {
    kind: "machinen.postgres-cross-arch-logical-psql-restore-gate-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    verifiedScope: {
      runtime: "postgresql",
      interface: "psql",
      subset: "postgres-clean-quiesced-cross-arch-logical-restore",
      directions,
      crossArchitecture: true,
      restoreMechanism: "target-native-logical-sql-restore",
      machinenNoDumpSnapshotRestore: false,
    },
    publicPortablePostgresClaimAllowed: false,
    publicClaim: {
      productSupport: 0,
      broadSupport: 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    guarantees: [
      "A native arm64 PostgreSQL container and native amd64 PostgreSQL container were both used.",
      "The clean quiesced psql workload restored arm64 -> amd64 and amd64 -> arm64.",
      "Target-native psql verifier output matched source verifier output in both directions.",
      "The retained verifier shows rowCount=4, valueSum=105, and expected payload/value arrays.",
      "Logical SQL dump artifacts are retained and hash-checked for both directions.",
    ],
    nonGuarantees: [
      "Does not prove no-dump Machinen product PostgreSQL snapshot/restore.",
      "Does not prove physical PostgreSQL data-directory portability across ISA.",
      "Does not prove live sessions, active transactions, dirty WAL, replication/failover state, native extensions, app hooks, sidecars, source ISA emulation, or metadata-only success.",
      "Does not raise the public portable PostgreSQL claim above 0 / 0 / 0.",
    ],
    routes,
    noShortcutPolicy: {
      physicalDataDirectoryPortable: false,
      sourceIsaEmulationUsed: false,
      sourceTextReplayAcceptedAsMachinenProductProof: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      metadataOnlyShortcutAccepted: false,
      targetNativeExecutionRequired: true,
    },
    refusalBoundaries: (summary?.refusals ?? []).map((row: any) => String(row.expectedRefusalCode)),
    checks,
    artifacts,
  };
}

function routeVerification(
  retainedRoot: string,
  summary: any,
  direction: Direction,
): RouteVerification {
  const route =
    summary?.postgres?.routes?.find((candidate: any) => candidate.route === direction) ?? {};
  const dumpPath = join(retainedRoot, direction, "postgres.logical.sql");
  const sourceTranscript = readText(join(retainedRoot, direction, "source-psql-transcript.txt"));
  const targetTranscript = readText(join(retainedRoot, direction, "target-psql-verifier.txt"));
  const retainedDumpSha256 = sha256(readFileSync(dumpPath));
  const checks = [
    check("route-present", route.route === direction, `${direction} route exists in summary`),
    check(
      "cross-arch",
      route.sourceArch !== route.targetArch,
      `${direction} is cross-architecture`,
    ),
    check(
      "migration-completed",
      route.migrationCompleted === true,
      `${direction} migration completed`,
    ),
    check(
      "target-native",
      route.targetNativeExecution === true,
      `${direction} target-native execution`,
    ),
    check(
      "source-target-verifier-match",
      sourceTranscript.trim() === targetTranscript.trim() &&
        sourceTranscript.trim() === route.sourceVerifierOutput &&
        targetTranscript.trim() === route.targetVerifierOutput,
      `${direction} source and target psql verifier output match`,
    ),
    check(
      "expected-database-shape",
      parsedVerifierValue(targetTranscript, "rowCount") === 4 &&
        parsedVerifierValue(targetTranscript, "valueSum") === 105,
      `${direction} target psql verifier has expected rows and aggregate`,
    ),
    check(
      "retained-dump-hash-match",
      route.dumpSha256 === retainedDumpSha256,
      `${direction} retained SQL dump hash matches summary`,
    ),
    check(
      "no-active-transactions",
      route.activeTransactionsAtCapture === 0,
      `${direction} captured with no active PostgreSQL transactions`,
    ),
    check(
      "no-route-shortcuts",
      route.sourceIsaEmulationUsed === false &&
        route.sourceTextReusedAsTargetCode === false &&
        route.sidecarRuntimeUsed === false &&
        route.appHooksRequired === false,
      `${direction} did not use source ISA emulation, source-text code replay, sidecar, or app hooks`,
    ),
  ];
  return {
    direction,
    accepted: checks.every((row) => row.passed),
    sourceArch: String(route.sourceArch ?? "unknown"),
    targetArch: String(route.targetArch ?? "unknown"),
    sourceHost: String(route.sourceHost ?? "unknown"),
    targetHost: String(route.targetHost ?? "unknown"),
    sourcePostgresVersion: String(route.sourcePostgresVersion ?? "unknown"),
    targetPostgresVersion: String(route.targetPostgresVersion ?? "unknown"),
    logicalFingerprint: String(route.logicalFingerprint ?? "unknown"),
    dumpSha256: String(route.dumpSha256 ?? "unknown"),
    retainedDumpSha256,
    sourceVerifierOutputSha256: sha256(sourceTranscript.trim()),
    targetVerifierOutputSha256: sha256(targetTranscript.trim()),
    checks,
  };
}

function routeVerifier(
  route: RouteVerification,
  report: PostgresCrossArchLogicalPsqlRestoreGateReport,
): unknown {
  return {
    kind: "machinen.postgres-cross-arch-logical-psql-route-verifier",
    accepted: route.accepted,
    direction: route.direction,
    sourceArch: route.sourceArch,
    targetArch: route.targetArch,
    crossArchitecture: true,
    restoreMechanism: report.verifiedScope.restoreMechanism,
    machinenNoDumpSnapshotRestore: false,
    sourceVerifierOutputSha256: route.sourceVerifierOutputSha256,
    targetVerifierOutputSha256: route.targetVerifierOutputSha256,
    sourceTargetVerifierMatch:
      route.sourceVerifierOutputSha256 === route.targetVerifierOutputSha256,
    dumpSha256: route.dumpSha256,
    retainedDumpSha256: route.retainedDumpSha256,
    forbiddenShortcuts: report.noShortcutPolicy,
    checks: route.checks,
  };
}

function parsedVerifierValue(text: string, key: string): unknown {
  try {
    return JSON.parse(text.trim())[key];
  } catch {
    return undefined;
  }
}

function check(id: string, passed: boolean, message: string): Check {
  return { id, passed, message };
}

function artifact(path: string): Artifact {
  const resolved = resolve(path);
  const exists = existsSync(resolved) && statSync(resolved).isFile();
  return {
    path: displayPath(resolved),
    exists,
    bytes: exists ? statSync(resolved).size : 0,
    sha256: exists ? sha256(readFileSync(resolved)) : "missing",
  };
}

function readJson(path: string): unknown {
  return JSON.parse(readText(path));
}

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function sha256(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

function displayPath(path: string): string {
  return path.replace(`${process.cwd()}/`, "");
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
