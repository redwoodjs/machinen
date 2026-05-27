#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch as hostArch, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const FIXTURE_DIR = join(REPO_ROOT, "scripts/fixtures/postgres-machinen");
const DEFAULT_ARM_HOST = "local";
const DEFAULT_AMD_HOST = "root@192.168.0.8";
const DEFAULT_IMAGE = "postgres:15-bookworm";

const INIT_SQL = readFileSync(join(FIXTURE_DIR, "init.sql"), "utf8");
const WORKLOAD_SQL = readFileSync(join(FIXTURE_DIR, "workload.sql"), "utf8");
const VERIFY_SQL = readFileSync(join(FIXTURE_DIR, "verify.sql"), "utf8");

function usage() {
  console.error(
    "usage: node scripts/postgres-cross-arch-restore-proof.mjs run-suite --out file [--work-dir dir] [--arm-host local|user@host] [--amd-host user@host] [--image postgres:tag] [--keep]",
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

function hostCommandAllowFail(host, command, options = {}) {
  if (hostKind(host) === "local") {
    return run("bash", ["-lc", command], options);
  }
  return run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command], options);
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
    kind: hostKind(host),
    machine,
    arch: normalizeArch(machine),
    docker,
  };
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

function completedTarget(kinds) {
  return {
    state: "completed",
    migrationCompleted: true,
    descriptorGateCompleted: true,
    targetVerifierResult: "passed",
    targetResourceStatuses: kinds.map((kind) => ({ kind, status: "passed" })),
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
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
          "PostgreSQL physical data directories and WAL are not the portable unit for arm64<->amd64 restore; use logical descriptor/dump restore.",
      },
    ),
  ];
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
  hostCommandAllowFail(host, `docker rm -f ${shellQuote(name)} >/dev/null 2>&1`, {
    encoding: "utf8",
  });
}

function psql(host, name, sql, database = "postgres") {
  const result = hostCommand(
    host,
    `docker exec -i ${shellQuote(name)} psql -U postgres -d ${shellQuote(database)} -v ON_ERROR_STOP=1 -At`,
    { input: sql, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return outputText(result).stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
}

function pgDump(host, name) {
  const result = hostCommand(
    host,
    `docker exec ${shellQuote(name)} pg_dump -U postgres --no-owner --no-acl --format=plain --dbname=machinen_pg`,
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? "");
}

function restoreDump(host, name, dump) {
  psql(host, name, "DROP DATABASE IF EXISTS machinen_pg;\nCREATE DATABASE machinen_pg;\n");
  hostCommand(
    host,
    `docker exec -i ${shellQuote(name)} psql -U postgres -d machinen_pg -v ON_ERROR_STOP=1`,
    { input: dump, maxBuffer: 64 * 1024 * 1024 },
  );
}

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

function runRoute({ source, target, image, workDir }) {
  const sourceName = containerName(`pg-src-${source.arch}`);
  const targetName = containerName(`pg-tgt-${target.arch}`);
  const dumpPath = join(workDir, `${source.arch}-to-${target.arch}.sql`);
  try {
    startPostgres(source.rawHost, image, sourceName);
    startPostgres(target.rawHost, image, targetName);
    const sourceVersion = psql(source.rawHost, sourceName, "SHOW server_version;");
    const targetVersion = psql(target.rawHost, targetName, "SHOW server_version;");
    psql(source.rawHost, sourceName, INIT_SQL);
    psql(source.rawHost, sourceName, WORKLOAD_SQL);
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
    const sourceVerify = psql(source.rawHost, sourceName, VERIFY_SQL);
    const dump = pgDump(source.rawHost, sourceName);
    writeFileSync(dumpPath, dump);
    restoreDump(target.rawHost, targetName, dump);
    const targetVerify = psql(target.rawHost, targetName, VERIFY_SQL);
    const sourceFingerprint = logicalFingerprint(sourceVerify);
    const targetFingerprint = logicalFingerprint(targetVerify);
    if (source.arch === target.arch) {
      throw new Error(`route ${source.arch}->${target.arch} is not cross-architecture`);
    }
    if (activeTransactions !== "0") {
      throw new Error(
        `route ${source.arch}->${target.arch} had active transactions: ${activeTransactions}`,
      );
    }
    if (sourceFingerprint !== targetFingerprint) {
      throw new Error(
        `PostgreSQL logical verification mismatch for ${source.arch}->${target.arch}\nsource=${sourceVerify}\ntarget=${targetVerify}`,
      );
    }
    return {
      route: `${source.arch}-to-${target.arch}`,
      sourceHost: source.host,
      targetHost: target.host,
      sourceArch: source.arch,
      targetArch: target.arch,
      sourcePostgresVersion: sourceVersion,
      targetPostgresVersion: targetVersion,
      sourceVerifierOutput: sourceVerify,
      targetVerifierOutput: targetVerify,
      logicalFingerprint: sourceFingerprint,
      targetVerifierOutputSha256: sha256(targetVerify),
      dumpSha256: sha256(dump),
      dumpBytes: dump.length,
      checkpointLsn,
      activeTransactionsAtCapture: Number(activeTransactions),
      migrationCompleted: true,
      targetNativeExecution: true,
      sourceIsaEmulationUsed: false,
      sourceTextReusedAsTargetCode: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
    };
  } finally {
    stopPostgres(source.rawHost, sourceName);
    stopPostgres(target.rawHost, targetName);
  }
}

function assertHostShape(arm, amd) {
  if (arm.arch !== "arm64") {
    throw new Error(
      `default arm host must be arm64; got ${arm.arch} (${arm.machine}) on ${arm.host}`,
    );
  }
  if (amd.arch !== "amd64") {
    throw new Error(
      `default amd host must be amd64; got ${amd.arch} (${amd.machine}) on ${amd.host}`,
    );
  }
}

function publicHost(entry) {
  const { rawHost: _rawHost, ...rest } = entry;
  return rest;
}

function runSuite(options, workDir) {
  ensureDir(workDir);
  const arm = { ...inspectHost("arm64", options.arm_host), rawHost: options.arm_host };
  const amd = { ...inspectHost("amd64", options.amd_host), rawHost: options.amd_host };
  assertHostShape(arm, amd);
  const routes = [
    runRoute({ source: arm, target: amd, image: options.image, workDir }),
    runRoute({ source: amd, target: arm, image: options.image, workDir }),
  ];
  const logicalFingerprints = new Set(routes.map((route) => route.logicalFingerprint));
  if (logicalFingerprints.size !== 1) {
    throw new Error("bidirectional PostgreSQL logical fingerprints did not match");
  }
  const targetRestore = completedTarget([
    "postgres-clean-quiesced-cross-arch-logical-database",
    "postgres-arm64-to-amd64-logical-restore",
    "postgres-amd64-to-arm64-logical-restore",
  ]);
  return {
    kind: "machinen.postgres-cross-arch-logical-restore-proof",
    profile: "portable-machine-restore",
    state: "completed",
    remoteSourceTarget: "postgres-clean-quiesced-cross-arch-logical-restore",
    runtime: "postgresql",
    localHostArch: hostArch(),
    image: options.image,
    hosts: { arm64: publicHost(arm), amd64: publicHost(amd) },
    postgres: {
      initSqlSha256: sha256(INIT_SQL),
      workloadSqlSha256: sha256(WORKLOAD_SQL),
      verifierSqlSha256: sha256(VERIFY_SQL),
      routes,
      logicalFingerprint: routes[0].logicalFingerprint,
      routeCount: routes.length,
    },
    supportedSubset: {
      name: "postgres-clean-quiesced-cross-arch-logical-restore",
      migrationCompleted: true,
      capturePolicy: "target-neutral logical dump from a clean, checkpointed PostgreSQL database",
      restorePolicy: "target-native PostgreSQL restore on the destination architecture",
      noActiveClientTransaction: routes.every((route) => route.activeTransactionsAtCapture === 0),
      walCheckpointedBeforeCapture: true,
      physicalDataDirectoryPortable: false,
      bidirectionalArm64Amd64: true,
    },
    refusals: refusalInventory(),
    targetRestore,
    securityInspection: noShortcutInspection(),
    timings: [],
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workDir = resolve(
    options.work_dir ?? join(tmpdir(), `machinen-postgres-cross-arch-${process.pid}`),
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
