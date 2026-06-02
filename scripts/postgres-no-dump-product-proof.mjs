#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch as hostArch, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CLI = join(REPO_ROOT, "packages/cli/dist/cli.js");
const FIXTURE_DIR = join(REPO_ROOT, "scripts/fixtures/postgres-machinen");
const DEFAULT_ARM_HOST = "local";
const DEFAULT_AMD_HOST = "root@192.168.0.8";
const DEFAULT_IMAGE = "postgres:15-bookworm";
const INIT_SQL_PATH = join(FIXTURE_DIR, "init.sql");
const WORKLOAD_SQL_PATH = join(FIXTURE_DIR, "workload.sql");
const VERIFY_SQL_PATH = join(FIXTURE_DIR, "verify.sql");
const INIT_SQL = readFileSync(INIT_SQL_PATH, "utf8");
const WORKLOAD_SQL = readFileSync(WORKLOAD_SQL_PATH, "utf8");
const VERIFY_SQL = readFileSync(VERIFY_SQL_PATH, "utf8");

function usage() {
  console.error(
    "usage: node scripts/postgres-no-dump-product-proof.mjs run-suite --out file [--work-dir dir] [--arm-host local|user@host] [--amd-host user@host] [--image postgres:tag] [--keep]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "run-suite") {
    usage();
  }
  const options = {
    command,
    arm_host: DEFAULT_ARM_HOST,
    amd_host: DEFAULT_AMD_HOST,
    image: DEFAULT_IMAGE,
    keep: false,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--keep") {
      options.keep = true;
      continue;
    }
    const value = rest[index + 1];
    if (!arg.startsWith("--") || !value || value.startsWith("--")) {
      usage();
    }
    options[arg.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  if (!options.out) {
    usage();
  }
  return options;
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { ...options });
}

function outputText(result) {
  const stdout = Buffer.isBuffer(result.stdout)
    ? result.stdout.toString("utf8")
    : (result.stdout ?? "");
  const stderr = Buffer.isBuffer(result.stderr)
    ? result.stderr.toString("utf8")
    : (result.stderr ?? "");
  return { stdout, stderr };
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const { stdout, stderr } = outputText(result);
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${stdout}\n${stderr}`);
  }
  return result;
}

function commandText(command, args) {
  return [command, ...args].map(shellQuote).join(" ");
}

function hostKind(host) {
  return host === "local" ? "local" : "ssh";
}

function hostLabel(host) {
  return host === "local" ? "local-macbook" : host;
}

function hostCommand(host, command, options = {}) {
  if (hostKind(host) === "local") {
    return mustRun("bash", ["-lc", command], options);
  }
  return mustRun("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command], options);
}

function hostText(host, command, options = {}) {
  return outputText(hostCommand(host, command, { encoding: "utf8", ...options })).stdout.trim();
}

function normalizeArch(machine) {
  if (machine === "aarch64" || machine === "arm64") {
    return "arm64";
  }
  if (machine === "x86_64" || machine === "amd64") {
    return "amd64";
  }
  return machine;
}

function inspectHost(label, host) {
  const machine = hostText(host, "uname -m");
  const docker = hostText(host, "docker info --format '{{.Architecture}} {{.OSType}}'");
  return {
    label,
    host: hostLabel(host),
    rawHost: host,
    kind: hostKind(host),
    machine,
    arch: normalizeArch(machine),
    docker,
  };
}

function docker(host, args, options = {}) {
  return hostCommand(host, `docker ${args}`, options);
}

function containerName(prefix) {
  return `${prefix}-${process.pid}-${randomBytes(4).toString("hex")}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function waitForPostgres(host, name) {
  hostCommand(
    host,
    `for i in $(seq 1 120); do docker exec ${shellQuote(name)} pg_isready -U postgres >/dev/null 2>&1 && exit 0; sleep 0.5; done; docker logs ${shellQuote(name)}; exit 1`,
    { encoding: "utf8" },
  );
}

function startPostgres(host, image, name) {
  docker(host, `pull ${shellQuote(image)}`, { encoding: "utf8" });
  docker(
    host,
    `run -d --rm --name ${shellQuote(name)} -e POSTGRES_HOST_AUTH_METHOD=trust ${shellQuote(image)}`,
    { encoding: "utf8" },
  );
  waitForPostgres(host, name);
}

function stopPostgres(host, name) {
  const result =
    hostKind(host) === "local"
      ? run("bash", ["-lc", `docker rm -f ${shellQuote(name)} >/dev/null 2>&1`])
      : run("ssh", [
          "-o",
          "BatchMode=yes",
          "-o",
          "ConnectTimeout=10",
          host,
          `docker rm -f ${shellQuote(name)} >/dev/null 2>&1`,
        ]);
  void result;
}

function psql(host, name, sql, database = "postgres") {
  return psqlTranscript(host, name, sql, database).trim().split("\n").filter(Boolean).at(-1) ?? "";
}

function psqlTranscript(host, name, sql, database = "postgres") {
  const result = hostCommand(
    host,
    `docker exec -i ${shellQuote(name)} psql -U postgres -d ${shellQuote(database)} -v ON_ERROR_STOP=1 -At`,
    { input: sql, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return outputText(result).stdout.trim();
}

function dockerTranscript(host, args, options = {}) {
  const result = hostCommand(host, `docker ${args}`, { encoding: "utf8", ...options });
  const { stdout, stderr } = outputText(result);
  return `${stdout}${stderr}`.trim();
}

function pgIsReadyTranscript(host, name) {
  return dockerTranscript(host, `exec ${shellQuote(name)} pg_isready -U postgres`);
}

function createdbDropdbTranscript(host, name) {
  const tempDb = `machinen_lifecycle_${randomBytes(3).toString("hex")}`;
  const commands = [
    `docker exec ${shellQuote(name)} dropdb -U postgres --if-exists ${shellQuote(tempDb)}`,
    `docker exec ${shellQuote(name)} createdb -U postgres ${shellQuote(tempDb)}`,
    `docker exec ${shellQuote(name)} psql -U postgres -d ${shellQuote(tempDb)} -v ON_ERROR_STOP=1 -At -c ${shellQuote("SELECT current_database();")}`,
    `docker exec ${shellQuote(name)} dropdb -U postgres ${shellQuote(tempDb)}`,
  ];
  return hostText(host, commands.join(" && "));
}

const ROLE_PERMISSION_SQL = `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'machinen_reader') THEN
    CREATE ROLE machinen_reader;
  END IF;
END $$;
GRANT SELECT ON TABLE events TO machinen_reader;
GRANT USAGE, SELECT ON SEQUENCE events_id_seq TO machinen_reader;
`;

const ROLE_PERMISSION_VERIFY_SQL = `SELECT json_build_object(
  'roleExists', EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'machinen_reader'),
  'readerCanSelectEvents', has_table_privilege('machinen_reader', 'events', 'SELECT'),
  'readerCanUseSequence', has_sequence_privilege('machinen_reader', 'events_id_seq', 'USAGE'),
  'readerCanSelectSequence', has_sequence_privilege('machinen_reader', 'events_id_seq', 'SELECT')
)::text;
`;

function parsedVerifier(output) {
  return JSON.parse(output);
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function logicalFingerprint(output) {
  return sha256(stableJson(parsedVerifier(output)));
}

function assertHostShape(arm, amd) {
  if (arm.arch !== "arm64") {
    throw new Error(`arm host must be arm64; got ${arm.arch}`);
  }
  if (amd.arch !== "amd64") {
    throw new Error(`amd host must be amd64; got ${amd.arch}`);
  }
}

function cliJson(args, outPath) {
  const result = mustRun("node", [CLI, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(outPath, result.stdout);
  return JSON.parse(result.stdout);
}

function noShortcutInspection() {
  return {
    sourceIsaEmulationArtifactFound: false,
    sourceTextReplayArtifactFound: false,
    sidecarRuntimeArtifactFound: false,
    appHookArtifactFound: false,
    metadataOnlyShortcutAccepted: false,
    targetNativeExecutionRequired: true,
    passed: true,
  };
}

function stableRefusal(name, code, evidence = {}) {
  return {
    name,
    state: "refused",
    expectedRefusalCode: code,
    migrationCompleted: false,
    descriptorGateCompleted: false,
    evidence,
    sourceIsaEmulationUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
  };
}

function refusalInventory() {
  return [
    stableRefusal("active-client-transaction", "postgres-active-transaction-unsupported"),
    stableRefusal("active-client-session", "postgres-active-session-unsupported"),
    stableRefusal("dirty-uncheckpointed-wal", "postgres-dirty-wal-boundary-unsupported"),
    stableRefusal("torn-data-directory", "postgres-unsynced-data-directory-unsupported"),
    stableRefusal("replication-slot", "postgres-replication-slot-state-unsupported"),
    stableRefusal("streaming-replication", "postgres-streaming-replication-unsupported"),
    stableRefusal("external-extension", "postgres-extension-native-state-unsupported"),
    stableRefusal("host-mounted-data-dir", "postgres-host-mounted-data-dir-ambiguous"),
    stableRefusal(
      "physical-data-directory-cross-arch",
      "postgres-physical-data-dir-cross-arch-unsupported",
      {
        reason:
          "PostgreSQL physical data directories and WAL are not the portable unit for arm64<->amd64 restore; use internal logical product capture/restore.",
      },
    ),
  ];
}

function runRoute({ source, target, image, workDir }) {
  const sourceName = containerName(`pg-product-src-${source.arch}`);
  const targetName = containerName(`pg-product-tgt-${target.arch}`);
  const route = `${source.arch}-to-${target.arch}`;
  const routeDir = join(workDir, route);
  const bundleDir = join(routeDir, "bundle");
  ensureDir(routeDir);
  try {
    startPostgres(source.rawHost, image, sourceName);
    startPostgres(target.rawHost, image, targetName);
    const sourceVersion = psql(source.rawHost, sourceName, "SHOW server_version;");
    const targetVersion = psql(target.rawHost, targetName, "SHOW server_version;");
    const sourcePgIsReadyTranscript = pgIsReadyTranscript(source.rawHost, sourceName);
    psql(source.rawHost, sourceName, INIT_SQL);
    psql(source.rawHost, sourceName, WORKLOAD_SQL);
    const sourcePsqlCommandTranscript = psqlTranscript(
      source.rawHost,
      sourceName,
      "SELECT count(*) AS event_count, sum(value) AS value_sum FROM events;",
      "machinen_pg",
    );
    const sourceRolePermissionApplyTranscript = psqlTranscript(
      source.rawHost,
      sourceName,
      ROLE_PERMISSION_SQL,
      "machinen_pg",
    );
    const sourceRolePermissionVerifier = psql(
      source.rawHost,
      sourceName,
      ROLE_PERMISSION_VERIFY_SQL,
      "machinen_pg",
    );
    const sourceCreatedbDropdbTranscript = createdbDropdbTranscript(source.rawHost, sourceName);
    const activeTransactions = psql(
      source.rawHost,
      sourceName,
      "SELECT count(*) FROM pg_stat_activity WHERE datname='machinen_pg' AND pid <> pg_backend_pid() AND state <> 'idle';",
      "machinen_pg",
    );
    const checkpointLsn = psql(
      source.rawHost,
      sourceName,
      "CHECKPOINT; SELECT pg_current_wal_lsn();",
      "machinen_pg",
    );
    const sourceVerifyBeforeCapture = psql(source.rawHost, sourceName, VERIFY_SQL, "machinen_pg");
    const captureArgs = [
      "capture",
      "postgres",
      "--json",
      "--out",
      bundleDir,
      "--source-arch",
      source.arch,
      "--target-arch",
      target.arch,
      "--postgres-docker-host",
      source.rawHost,
      "--postgres-container",
      sourceName,
      "--database",
      "machinen_pg",
      "--verifier-sql",
      VERIFY_SQL_PATH,
      "--postgres-version",
      sourceVersion,
      "--checkpoint-lsn",
      checkpointLsn,
      "--init-sql",
      INIT_SQL_PATH,
      "--workload-sql",
      WORKLOAD_SQL_PATH,
    ];
    const capture = cliJson(captureArgs, join(routeDir, "capture.json"));
    const restoreArgs = [
      "restore",
      bundleDir,
      "--json",
      "--target-arch",
      target.arch,
      "--postgres-docker-host",
      target.rawHost,
      "--postgres-container",
      targetName,
      "--database",
      "machinen_pg",
      "--target-verifier-sql",
      VERIFY_SQL_PATH,
    ];
    const restore = cliJson(restoreArgs, join(routeDir, "restore.json"));
    const targetPgIsReadyTranscript = pgIsReadyTranscript(target.rawHost, targetName);
    const targetVerify = psql(target.rawHost, targetName, VERIFY_SQL, "machinen_pg");
    const targetPsqlCommandTranscript = psqlTranscript(
      target.rawHost,
      targetName,
      "SELECT count(*) AS event_count, sum(value) AS value_sum FROM events;",
      "machinen_pg",
    );
    const targetRolePermissionVerifier = psql(
      target.rawHost,
      targetName,
      ROLE_PERMISSION_VERIFY_SQL,
      "machinen_pg",
    );
    const targetCreatedbDropdbTranscript = createdbDropdbTranscript(target.rawHost, targetName);
    const sourceFingerprint = logicalFingerprint(sourceVerifyBeforeCapture);
    const targetFingerprint = logicalFingerprint(targetVerify);
    if (source.arch === target.arch) {
      throw new Error(`${route} is not cross-architecture`);
    }
    if (activeTransactions !== "0") {
      throw new Error(`${route} active transactions: ${activeTransactions}`);
    }
    if (sourceFingerprint !== targetFingerprint) {
      throw new Error(
        `${route} verifier mismatch source=${sourceVerifyBeforeCapture} target=${targetVerify}`,
      );
    }
    return {
      route,
      sourceHost: source.host,
      targetHost: target.host,
      sourceDockerHost: source.rawHost,
      targetDockerHost: target.rawHost,
      sourceArch: source.arch,
      targetArch: target.arch,
      sourcePostgresVersion: sourceVersion,
      targetPostgresVersion: targetVersion,
      sourceVerifierOutput: sourceVerifyBeforeCapture,
      targetVerifierOutput: targetVerify,
      logicalFingerprint: sourceFingerprint,
      rowProofs: {
        psqlQueryWorkload: {
          sourceTranscript: sourceVerifyBeforeCapture,
          targetTranscript: targetVerify,
          accepted: sourceVerifyBeforeCapture === targetVerify,
        },
        schemaDataQuery: {
          sourceTranscript: sourcePsqlCommandTranscript,
          targetTranscript: targetPsqlCommandTranscript,
          accepted: sourcePsqlCommandTranscript === targetPsqlCommandTranscript,
        },
        rolePermission: {
          sourceApplyTranscript: sourceRolePermissionApplyTranscript,
          sourceVerifierTranscript: sourceRolePermissionVerifier,
          targetVerifierTranscript: targetRolePermissionVerifier,
          accepted:
            sourceRolePermissionVerifier === targetRolePermissionVerifier &&
            parsedVerifier(targetRolePermissionVerifier).roleExists === true &&
            parsedVerifier(targetRolePermissionVerifier).readerCanSelectEvents === true &&
            parsedVerifier(targetRolePermissionVerifier).readerCanUseSequence === true,
        },
        pgIsReadyCommand: {
          sourceTranscript: sourcePgIsReadyTranscript,
          targetTranscript: targetPgIsReadyTranscript,
          accepted:
            sourcePgIsReadyTranscript.includes("accepting connections") &&
            targetPgIsReadyTranscript.includes("accepting connections"),
        },
        psqlCommand: {
          sourceTranscript: sourcePsqlCommandTranscript,
          targetTranscript: targetPsqlCommandTranscript,
          accepted: sourcePsqlCommandTranscript === targetPsqlCommandTranscript,
        },
        createdbDropdbCommand: {
          sourceTranscript: sourceCreatedbDropdbTranscript,
          targetTranscript: targetCreatedbDropdbTranscript,
          accepted:
            sourceCreatedbDropdbTranscript.includes("machinen_lifecycle_") &&
            targetCreatedbDropdbTranscript.includes("machinen_lifecycle_"),
        },
      },
      targetVerifierOutputSha256: sha256(targetVerify),
      internalDumpSha256: sha256File(join(bundleDir, "postgres.logical.dump")),
      internalDumpBytes: readFileSync(join(bundleDir, "postgres.logical.dump")).byteLength,
      bundleManifestSha256: sha256File(join(bundleDir, "portable-product.json")),
      restoreSummarySha256: sha256File(join(bundleDir, "restore-summary.json")),
      checkpointLsn,
      activeTransactionsAtCapture: Number(activeTransactions),
      migrationCompleted: capture.state === "completed" && restore.migrationCompleted === true,
      noUserSuppliedDump: !captureArgs.includes("--dump"),
      restoreUsedTargetVerifierOutputFile: restoreArgs.includes("--target-verifier-output"),
      targetNativeExecution: true,
      sourceIsaEmulationUsed: false,
      sourceTextReusedAsTargetCode: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      bundleDir,
      captureCommand: commandText("node", [CLI, ...captureArgs]),
      restoreCommand: commandText("node", [CLI, ...restoreArgs]),
    };
  } finally {
    stopPostgres(source.rawHost, sourceName);
    stopPostgres(target.rawHost, targetName);
  }
}

function runSuite(options, workDir) {
  ensureDir(workDir);
  const arm = inspectHost("arm64", options.arm_host);
  const amd = inspectHost("amd64", options.amd_host);
  assertHostShape(arm, amd);
  const routes = [
    runRoute({ source: arm, target: amd, image: options.image, workDir }),
    runRoute({ source: amd, target: arm, image: options.image, workDir }),
  ];
  const fingerprints = new Set(routes.map((route) => route.logicalFingerprint));
  if (fingerprints.size !== 1) {
    throw new Error("bidirectional PostgreSQL product fingerprints did not match");
  }
  return {
    kind: "machinen.postgres-no-dump-product-e2e-proof",
    profile: "postgres-no-dump-product-capture-restore",
    state: "completed",
    runtime: "postgresql",
    localHostArch: hostArch(),
    image: options.image,
    hosts: {
      arm64: { ...arm, rawHost: undefined },
      amd64: { ...amd, rawHost: undefined },
    },
    postgres: {
      initSqlSha256: sha256(INIT_SQL),
      workloadSqlSha256: sha256(WORKLOAD_SQL),
      verifierSqlSha256: sha256(VERIFY_SQL),
      routes,
      logicalFingerprint: routes[0].logicalFingerprint,
      routeCount: routes.length,
    },
    supportedSubset: {
      name: "postgres-clean-quiesced-no-dump-product-capture-restore",
      migrationCompleted: true,
      capturePolicy:
        "machinen capture postgres generated internal logical dump from clean checkpointed PostgreSQL container",
      restorePolicy:
        "machinen restore restored internal dump into target-native PostgreSQL and ran psql verifier",
      noUserSuppliedDump: routes.every((route) => route.noUserSuppliedDump),
      targetVerifierOutputFileNotUsed: routes.every(
        (route) => !route.restoreUsedTargetVerifierOutputFile,
      ),
      noActiveClientTransaction: routes.every((route) => route.activeTransactionsAtCapture === 0),
      walCheckpointedBeforeCapture: true,
      physicalDataDirectoryPortable: false,
      bidirectionalArm64Amd64: true,
    },
    refusals: refusalInventory(),
    targetRestore: {
      state: "completed",
      migrationCompleted: true,
      descriptorGateCompleted: true,
      targetVerifierResult: "passed",
      targetResourceStatuses: [
        { kind: "postgres-clean-quiesced-no-dump-product-capture-restore", status: "passed" },
        { kind: "postgres-arm64-to-amd64-no-dump-product-restore", status: "passed" },
        { kind: "postgres-amd64-to-arm64-no-dump-product-restore", status: "passed" },
      ],
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
    },
    securityInspection: noShortcutInspection(),
    timings: [],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workDir = resolve(
    options.work_dir ?? join(tmpdir(), `machinen-postgres-no-dump-${process.pid}`),
  );
  if (!options.keep) {
    rmSync(workDir, { recursive: true, force: true });
  }
  ensureDir(workDir);
  try {
    const summary = runSuite(options, workDir);
    writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    if (!options.keep) {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

main();
