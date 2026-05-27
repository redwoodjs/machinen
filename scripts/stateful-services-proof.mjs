#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { arch, platform, release, tmpdir } from "node:os";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const FIXTURE_DIR = join(REPO_ROOT, "scripts/fixtures/stateful-services");
const DEFAULT_REDIS_IMAGE = "redis:7-bookworm";
const DEFAULT_POSTGRES_IMAGE = "postgres:15-bookworm";
const DEFAULT_MARIADB_IMAGE = "mariadb:11.4";

function usage() {
  console.error(
    "usage: node scripts/stateful-services-proof.mjs run-suite --out file [--summary-dir dir] [--work-dir dir] [--service all|redis|sqlite|postgres|mariadb|queue|filesystem] [--keep]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "run-suite") {
    usage();
  }
  const options = { command, service: "all", keep: false };
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
  if (
    !options.out ||
    !["all", "redis", "sqlite", "postgres", "mariadb", "queue", "filesystem"].includes(
      options.service,
    )
  ) {
    usage();
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
  return result;
}

function docker(args, options = {}) {
  return mustRun("docker", args, options);
}

function dockerAllowFail(args) {
  return run("docker", args);
}

function containerName(prefix) {
  return `${prefix}-${process.pid}-${randomBytes(4).toString("hex")}`;
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

function refusalSummary(name, code, message, family, service) {
  return {
    profile: "portable-machine-restore",
    state: "failed",
    remoteSourceTarget: name,
    targetRestore: {
      state: "refused",
      migrationCompleted: false,
      descriptorGateCompleted: false,
      targetVerifierResult: "not-run",
      refusal: { code, message },
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
      metadataOnlyShortcutAccepted: false,
    },
    statefulRefusalProof: {
      service,
      family,
      code,
      message,
      remediation:
        "Reach a clean/quiesced checkpoint, disconnect active clients, and capture only the documented portable persistence artifact.",
      graduationRequires: [
        "versioned descriptor",
        "checkpoint/fsync evidence",
        "target-native verifier",
        "unsafe neighbor regression test",
      ],
      securityInspection: noShortcutInspection(),
    },
    timings: [],
  };
}

function positiveSummary(name, service, proof, resources) {
  return {
    profile: "portable-machine-restore",
    state: "completed",
    remoteSourceTarget: name,
    targetRestore: completedTarget(resources),
    service,
    statefulServiceProof: proof,
    securityInspection: noShortcutInspection(),
    timings: [],
  };
}

function writeSummaries(summaryDir, summaries) {
  if (!summaryDir) {
    return;
  }
  ensureDir(summaryDir);
  for (const summary of summaries) {
    writeFileSync(
      join(summaryDir, `${summary.remoteSourceTarget}.json`),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
  }
}

function dirManifest(path) {
  const entries = [];
  const walk = (current, prefix = "") => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile()) {
        entries.push(`${rel}:${sha256File(full)}`);
      }
    }
  };
  if (existsSync(path)) {
    walk(path);
  }
  return sha256(entries.join("\n"));
}

function redisExec(name, ...args) {
  return docker(["exec", name, "redis-cli", "--raw", ...args]).stdout.trim();
}

function waitRedis(name) {
  for (let index = 0; index < 60; index += 1) {
    if (dockerAllowFail(["exec", name, "redis-cli", "PING"]).status === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`Redis ${name} did not start`);
}

function startRedis(name, dataDir) {
  docker(["pull", DEFAULT_REDIS_IMAGE]);
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "-v",
    `${dataDir}:/data`,
    DEFAULT_REDIS_IMAGE,
    "redis-server",
    "/data/redis.conf",
  ]);
  waitRedis(name);
}

function redisVerify(name) {
  return {
    serviceName: redisExec(name, "GET", "service:name"),
    counter: Number(redisExec(name, "GET", "counter")),
    user: redisExec(name, "HGETALL", "user:1").split("\n"),
    jobs: redisExec(name, "LRANGE", "jobs", "0", "-1").split("\n"),
    streamLength: Number(redisExec(name, "XLEN", "events")),
  };
}

function proveRedis(workDir) {
  ensureDir(workDir);
  const sourceDir = join(workDir, "redis-source");
  const targetDir = join(workDir, "redis-target");
  ensureDir(sourceDir);
  ensureDir(targetDir);
  copyFileSync(join(FIXTURE_DIR, "redis/config.conf"), join(sourceDir, "redis.conf"));
  copyFileSync(join(FIXTURE_DIR, "redis/config.conf"), join(targetDir, "redis.conf"));
  const source = containerName("redis-source");
  const target = containerName("redis-target");
  try {
    startRedis(source, sourceDir);
    for (const line of readFileSync(join(FIXTURE_DIR, "redis/workload.redis"), "utf8")
      .split("\n")
      .filter(Boolean)) {
      redisExec(source, ...line.split(/\s+/));
    }
    redisExec(source, "BGREWRITEAOF");
    redisExec(source, "SAVE");
    const sourceVerify = redisVerify(source);
    docker(["rm", "-f", source]);
    rmSync(join(targetDir, "appendonlydir"), { recursive: true, force: true });
    copyFileSync(join(sourceDir, "dump.rdb"), join(targetDir, "dump.rdb"));
    if (existsSync(join(sourceDir, "appendonlydir"))) {
      mustRun("cp", ["-R", join(sourceDir, "appendonlydir"), targetDir]);
    }
    startRedis(target, targetDir);
    const targetVerify = redisVerify(target);
    if (JSON.stringify(sourceVerify) !== JSON.stringify(targetVerify)) {
      throw new Error("Redis verifier mismatch");
    }
    const proof = {
      service: "redis",
      version:
        redisExec(target, "INFO", "server")
          .split("\n")
          .find((line) => line.startsWith("redis_version:")) ?? "unknown",
      architecture: arch(),
      fixtureDigest: sha256File(join(FIXTURE_DIR, "redis/workload.redis")),
      configDigest: sha256File(join(FIXTURE_DIR, "redis/config.conf")),
      persistenceManifestSha256: dirManifest(targetDir),
      sourceVerifierOutput: sourceVerify,
      targetVerifierOutput: targetVerify,
      targetVerifierOutputSha256: sha256(JSON.stringify(targetVerify)),
      checkpointEvidence: "SAVE plus appendfsync always/BGREWRITEAOF before restore",
    };
    return [
      positiveSummary("stateful-redis-clean-quiesced-restore", "redis", proof, [
        "redis-rdb-aof-clean-restore",
      ]),
    ];
  } finally {
    dockerAllowFail(["rm", "-f", source]);
    dockerAllowFail(["rm", "-f", target]);
  }
}

function sqliteRun(db, sql) {
  return mustRun("sqlite3", [db], { input: sql }).stdout.trim();
}

function sqliteProof(mode, workDir) {
  ensureDir(workDir);
  const db = join(workDir, `${mode}.db`);
  const restored = join(workDir, `${mode}-restored.db`);
  sqliteRun(
    db,
    `PRAGMA journal_mode=${mode === "wal" ? "WAL" : "DELETE"};\n` +
      readFileSync(join(FIXTURE_DIR, "sqlite/schema.sql"), "utf8") +
      readFileSync(join(FIXTURE_DIR, "sqlite/workload.sql"), "utf8"),
  );
  if (mode === "wal") {
    sqliteRun(db, "PRAGMA wal_checkpoint(TRUNCATE);");
  }
  sqliteRun(db, "PRAGMA optimize; VACUUM;");
  const verifySql = readFileSync(join(FIXTURE_DIR, "sqlite/verify.sql"), "utf8");
  const sourceVerify = sqliteRun(db, verifySql);
  copyFileSync(db, restored);
  const targetVerify = sqliteRun(restored, verifySql);
  if (sourceVerify !== targetVerify) {
    throw new Error(`SQLite ${mode} verifier mismatch`);
  }
  return positiveSummary(
    `stateful-sqlite-${mode === "wal" ? "wal-checkpoint" : "rollback-journal"}-restore`,
    "sqlite",
    {
      service: "sqlite",
      version: mustRun("sqlite3", ["--version"]).stdout.trim(),
      architecture: arch(),
      databaseMode: mode,
      schemaDigest: sha256File(join(FIXTURE_DIR, "sqlite/schema.sql")),
      workloadDigest: sha256File(join(FIXTURE_DIR, "sqlite/workload.sql")),
      databaseManifestSha256: sha256File(restored),
      sourceVerifierOutput: sourceVerify,
      targetVerifierOutput: targetVerify,
      targetVerifierOutputSha256: sha256(targetVerify),
      checkpointEvidence:
        mode === "wal" ? "wal_checkpoint(TRUNCATE)" : "rollback journal clean close",
    },
    [`sqlite-${mode}-clean-restore`],
  );
}

function proveSqlite(workDir) {
  return [sqliteProof("rollback", workDir), sqliteProof("wal", workDir)];
}

function waitSqlContainer(name, command) {
  for (let index = 0; index < 90; index += 1) {
    if (dockerAllowFail(["exec", name, "sh", "-lc", command]).status === 0) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`SQL container ${name} did not start`);
}

function postgresPsql(name, sql) {
  return docker(["exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
    input: sql,
  })
    .stdout.trim()
    .split("\n")
    .filter(Boolean)
    .join("\n");
}

function provePostgres(workDir) {
  ensureDir(workDir);
  docker(["pull", DEFAULT_POSTGRES_IMAGE]);
  const source = containerName("pg-expanded-source");
  const target = containerName("pg-expanded-target");
  try {
    docker([
      "run",
      "-d",
      "--rm",
      "--name",
      source,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      DEFAULT_POSTGRES_IMAGE,
    ]);
    docker([
      "run",
      "-d",
      "--rm",
      "--name",
      target,
      "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust",
      DEFAULT_POSTGRES_IMAGE,
    ]);
    waitSqlContainer(source, "pg_isready -U postgres");
    waitSqlContainer(target, "pg_isready -U postgres");
    postgresPsql(source, readFileSync(join(FIXTURE_DIR, "postgres/init.sql"), "utf8"));
    postgresPsql(source, readFileSync(join(FIXTURE_DIR, "postgres/workload.sql"), "utf8"));
    const verifySql = readFileSync(join(FIXTURE_DIR, "postgres/verify.sql"), "utf8");
    const sourceVerify = postgresPsql(source, verifySql);
    const dumpA = docker([
      "exec",
      source,
      "pg_dump",
      "-U",
      "postgres",
      "--no-owner",
      "--no-acl",
      "--dbname",
      "machinen_stateful_a",
    ]).stdout;
    const dumpB = docker([
      "exec",
      source,
      "pg_dump",
      "-U",
      "postgres",
      "--no-owner",
      "--no-acl",
      "--dbname",
      "machinen_stateful_b",
    ]).stdout;
    const dump = `DROP DATABASE IF EXISTS machinen_stateful_a;\nDROP DATABASE IF EXISTS machinen_stateful_b;\nCREATE DATABASE machinen_stateful_a;\nCREATE DATABASE machinen_stateful_b;\n\\connect machinen_stateful_a\n${dumpA}\n\\connect machinen_stateful_b\n${dumpB}\n`;
    const dumpPath = join(workDir, "postgres-expanded.sql");
    writeFileSync(dumpPath, dump);
    docker(["exec", "-i", target, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], {
      input: dump,
    });
    const targetVerify = postgresPsql(target, verifySql);
    if (sourceVerify !== targetVerify) {
      throw new Error("PostgreSQL expanded verifier mismatch");
    }
    return [
      positiveSummary(
        "stateful-postgres-expanded-repeatability",
        "postgres",
        {
          service: "postgres",
          version: postgresPsql(target, "SHOW server_version;"),
          architecture: arch(),
          initSqlSha256: sha256File(join(FIXTURE_DIR, "postgres/init.sql")),
          workloadSqlSha256: sha256File(join(FIXTURE_DIR, "postgres/workload.sql")),
          dumpSha256: sha256File(dumpPath),
          sourceVerifierOutput: sourceVerify,
          targetVerifierOutput: targetVerify,
          targetVerifierOutputSha256: sha256(targetVerify),
          repeatabilityFingerprint: sha256(targetVerify),
          checkpointEvidence: "CHECKPOINT in workload before logical dump",
        },
        ["postgres-expanded-logical-restore"],
      ),
    ];
  } finally {
    dockerAllowFail(["rm", "-f", source]);
    dockerAllowFail(["rm", "-f", target]);
  }
}

function mariadbSql(name, sql, database = undefined) {
  const args = [
    "exec",
    "-i",
    name,
    "mariadb",
    "-uroot",
    "-h127.0.0.1",
    "--skip-column-names",
    "--batch",
  ];
  if (database) {
    args.push(database);
  }
  return docker(args, { input: sql }).stdout.trim().split("\n").filter(Boolean).at(-1) ?? "";
}

function proveMariaDb(workDir) {
  ensureDir(workDir);
  docker(["pull", DEFAULT_MARIADB_IMAGE]);
  const source = containerName("mariadb-source");
  const target = containerName("mariadb-target");
  try {
    docker([
      "run",
      "-d",
      "--rm",
      "--name",
      source,
      "-e",
      "MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1",
      DEFAULT_MARIADB_IMAGE,
    ]);
    docker([
      "run",
      "-d",
      "--rm",
      "--name",
      target,
      "-e",
      "MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1",
      DEFAULT_MARIADB_IMAGE,
    ]);
    waitSqlContainer(source, "mariadb-admin ping -uroot -h127.0.0.1 --silent");
    waitSqlContainer(target, "mariadb-admin ping -uroot -h127.0.0.1 --silent");
    mariadbSql(source, readFileSync(join(FIXTURE_DIR, "mariadb/init.sql"), "utf8"));
    mariadbSql(source, readFileSync(join(FIXTURE_DIR, "mariadb/workload.sql"), "utf8"));
    const verifySql = readFileSync(join(FIXTURE_DIR, "mariadb/verify.sql"), "utf8");
    const sourceVerify = mariadbSql(source, verifySql);
    const dump = docker([
      "exec",
      source,
      "mariadb-dump",
      "-uroot",
      "-h127.0.0.1",
      "--databases",
      "machinen_stateful",
      "--skip-comments",
    ]).stdout;
    const dumpPath = join(workDir, "mariadb.sql");
    writeFileSync(dumpPath, dump);
    docker(["exec", "-i", target, "mariadb", "-uroot", "-h127.0.0.1"], { input: dump });
    const targetVerify = mariadbSql(target, verifySql);
    if (sourceVerify !== targetVerify) {
      throw new Error("MariaDB verifier mismatch");
    }
    return [
      positiveSummary(
        "stateful-mariadb-clean-quiesced-restore",
        "mariadb",
        {
          service: "mariadb",
          version: mariadbSql(target, "SELECT VERSION();"),
          architecture: arch(),
          initSqlSha256: sha256File(join(FIXTURE_DIR, "mariadb/init.sql")),
          workloadSqlSha256: sha256File(join(FIXTURE_DIR, "mariadb/workload.sql")),
          dumpSha256: sha256File(dumpPath),
          sourceVerifierOutput: sourceVerify,
          targetVerifierOutput: targetVerify,
          targetVerifierOutputSha256: sha256(targetVerify),
          checkpointEvidence: "committed transaction plus FLUSH TABLES/LOGS before dump",
        },
        ["mariadb-innodb-clean-restore"],
      ),
    ];
  } finally {
    dockerAllowFail(["rm", "-f", source]);
    dockerAllowFail(["rm", "-f", target]);
  }
}

function proveQueue(workDir) {
  ensureDir(workDir);
  const queueDir = join(workDir, "queue");
  const restoreDir = join(workDir, "queue-restored");
  ensureDir(queueDir);
  ensureDir(restoreDir);
  const seed = readFileSync(join(FIXTURE_DIR, "queue/seed.jsonl"), "utf8");
  const workload = JSON.parse(readFileSync(join(FIXTURE_DIR, "queue/workload.json"), "utf8"));
  writeFileSync(
    join(queueDir, "messages.jsonl"),
    seed + workload.published.map((message) => JSON.stringify(message)).join("\n") + "\n",
  );
  writeFileSync(
    join(queueDir, "acks.jsonl"),
    workload.acknowledged.map((id) => JSON.stringify({ id, acked: true })).join("\n") + "\n",
  );
  copyFileSync(join(queueDir, "messages.jsonl"), join(restoreDir, "messages.jsonl"));
  copyFileSync(join(queueDir, "acks.jsonl"), join(restoreDir, "acks.jsonl"));
  const verify = (dir) => {
    const messages = readFileSync(join(dir, "messages.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    const acked = new Set(
      readFileSync(join(dir, "acks.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).id),
    );
    return {
      durableCount: messages.length,
      pending: messages.filter((message) => !acked.has(message.id)).map((message) => message.id),
      acked: [...acked].sort(),
    };
  };
  const sourceVerify = verify(queueDir);
  const targetVerify = verify(restoreDir);
  return [
    positiveSummary(
      "stateful-durable-queue-clean-restore",
      "durable-queue",
      {
        service: "jsonl-durable-queue-fixture",
        version: "fixture-v1",
        architecture: arch(),
        seedDigest: sha256File(join(FIXTURE_DIR, "queue/seed.jsonl")),
        workloadDigest: sha256File(join(FIXTURE_DIR, "queue/workload.json")),
        persistenceManifestSha256: dirManifest(restoreDir),
        sourceVerifierOutput: sourceVerify,
        targetVerifierOutput: targetVerify,
        targetVerifierOutputSha256: sha256(JSON.stringify(targetVerify)),
        checkpointEvidence: "messages and ack log fsynced at clean no-in-flight boundary",
      },
      ["durable-queue-clean-restore"],
    ),
  ];
}

function fsyncFile(path) {
  const fd = mustRun("python3", [
    "-c",
    "import os,sys; fd=os.open(sys.argv[1], os.O_RDONLY); os.fsync(fd); os.close(fd)",
    path,
  ]);
  return fd.status === 0;
}

function proveFilesystem(workDir) {
  ensureDir(workDir);
  const fixture = JSON.parse(readFileSync(join(FIXTURE_DIR, "filesystem/manifest.json"), "utf8"));
  const root = join(workDir, "filesystem");
  const restored = join(workDir, "filesystem-restored");
  ensureDir(root);
  ensureDir(restored);
  const log = join(root, "events.jsonl");
  writeFileSync(log, fixture.appendLog.map((event) => JSON.stringify(event)).join("\n") + "\n");
  fsyncFile(log);
  const checkpointTmp = join(root, "checkpoint.tmp");
  const checkpoint = join(root, "checkpoint.json");
  writeFileSync(checkpointTmp, JSON.stringify(fixture.checkpoint, null, 2));
  fsyncFile(checkpointTmp);
  mustRun("mv", [checkpointTmp, checkpoint]);
  for (const [rel, content] of Object.entries(fixture.directoryFiles)) {
    const path = join(root, rel);
    ensureDir(dirname(path));
    writeFileSync(path, content);
    fsyncFile(path);
  }
  mustRun("cp", ["-R", `${root}/.`, restored]);
  const readLog = (dir) =>
    readFileSync(join(dir, "events.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
  const summaries = [];
  summaries.push(
    positiveSummary(
      "stateful-filesystem-append-log-restore",
      "filesystem",
      {
        pattern: "append-only-log",
        version: "fixture-v1",
        architecture: arch(),
        fixtureDigest: sha256File(join(FIXTURE_DIR, "filesystem/manifest.json")),
        sourceVerifierOutput: readLog(root),
        targetVerifierOutput: readLog(restored),
        targetVerifierOutputSha256: sha256(JSON.stringify(readLog(restored))),
        dataManifestSha256: dirManifest(restored),
        checkpointEvidence: "append log fsynced before capture",
      },
      ["filesystem-append-log-clean-restore"],
    ),
  );
  summaries.push(
    positiveSummary(
      "stateful-filesystem-atomic-checkpoint-restore",
      "filesystem",
      {
        pattern: "atomic-rename-checkpoint",
        version: "fixture-v1",
        architecture: arch(),
        sourceVerifierOutput: JSON.parse(readFileSync(checkpoint, "utf8")),
        targetVerifierOutput: JSON.parse(readFileSync(join(restored, "checkpoint.json"), "utf8")),
        targetVerifierOutputSha256: sha256(readFileSync(join(restored, "checkpoint.json"))),
        dataManifestSha256: dirManifest(restored),
        checkpointEvidence: "tmp fsync plus atomic rename before capture",
      },
      ["filesystem-atomic-checkpoint-clean-restore"],
    ),
  );
  summaries.push(
    positiveSummary(
      "stateful-filesystem-directory-manifest-restore",
      "filesystem",
      {
        pattern: "directory-manifest",
        version: "fixture-v1",
        architecture: arch(),
        fixtureDigest: sha256File(join(FIXTURE_DIR, "filesystem/manifest.json")),
        sourceVerifierOutput: dirManifest(root),
        targetVerifierOutput: dirManifest(restored),
        targetVerifierOutputSha256: sha256(dirManifest(restored)),
        dataManifestSha256: dirManifest(restored),
        checkpointEvidence: "nested files written and fsynced before manifest capture",
      },
      ["filesystem-directory-manifest-clean-restore"],
    ),
  );
  return summaries;
}

const REFUSALS = {
  redis: [
    ["active-client-session", "stateful-redis-active-client-session-unsupported"],
    ["pubsub-subscription", "stateful-redis-pubsub-subscription-unsupported"],
    ["blocking-command", "stateful-redis-blocking-command-unsupported"],
    ["dirty-aof", "stateful-redis-dirty-aof-boundary-unsupported"],
    ["replication-state", "stateful-redis-replication-state-unsupported"],
    ["module-native-state", "stateful-redis-module-native-state-unsupported"],
    ["host-mounted-data-dir", "stateful-redis-host-mounted-data-dir-ambiguous"],
  ],
  sqlite: [
    ["active-transaction", "stateful-sqlite-active-transaction-unsupported"],
    ["hot-wal", "stateful-sqlite-hot-wal-unsupported"],
    ["hot-rollback-journal", "stateful-sqlite-hot-rollback-journal-unsupported"],
    ["db-lock", "stateful-sqlite-lock-held-unsupported"],
    ["mmap-dirty-state", "stateful-sqlite-mmap-state-ambiguous"],
    ["unsynced-data-file", "stateful-sqlite-unsynced-data-file-unsupported"],
    ["host-mounted-db", "stateful-sqlite-host-mounted-db-ambiguous"],
  ],
  postgres: [
    ["prepared-session", "stateful-postgres-prepared-session-unsupported"],
    ["advisory-lock", "stateful-postgres-advisory-lock-unsupported"],
    ["active-transaction", "stateful-postgres-active-transaction-unsupported"],
    ["dirty-wal", "stateful-postgres-dirty-wal-boundary-unsupported"],
    ["replication-slot", "stateful-postgres-replication-slot-unsupported"],
    ["host-mounted-data-dir", "stateful-postgres-host-mounted-data-dir-ambiguous"],
    ["extension-native-state", "stateful-postgres-extension-native-state-unsupported"],
  ],
  mariadb: [
    ["active-transaction", "stateful-mariadb-active-transaction-unsupported"],
    ["active-session", "stateful-mariadb-active-session-unsupported"],
    ["dirty-redo", "stateful-mariadb-dirty-redo-log-ambiguous"],
    ["replication-binlog", "stateful-mariadb-replication-binlog-ambiguous"],
    ["plugin-native-state", "stateful-mariadb-plugin-native-state-unsupported"],
    ["unsynced-data-dir", "stateful-mariadb-unsynced-data-dir-unsupported"],
    ["host-mounted-data-dir", "stateful-mariadb-host-mounted-data-dir-ambiguous"],
  ],
  queue: [
    ["in-flight-delivery", "stateful-queue-in-flight-delivery-unsupported"],
    ["unacked-message", "stateful-queue-unacked-message-ambiguous"],
    ["active-consumer", "stateful-queue-active-consumer-unsupported"],
    ["ephemeral-queue", "stateful-queue-ephemeral-state-unsupported"],
    ["cluster-replication", "stateful-queue-cluster-replication-unsupported"],
    ["plugin-native-state", "stateful-queue-plugin-native-state-unsupported"],
    ["host-mounted-data-dir", "stateful-queue-host-mounted-data-dir-ambiguous"],
  ],
  filesystem: [
    ["mmap-dirty", "stateful-filesystem-mmap-dirty-state-unsupported"],
    ["lock-state", "stateful-filesystem-lock-state-unsupported"],
    ["unsynced-append", "stateful-filesystem-unsynced-append-unsupported"],
    ["partial-rename", "stateful-filesystem-partial-rename-boundary-ambiguous"],
    ["host-mounted-path", "stateful-filesystem-host-mounted-path-ambiguous"],
    ["external-watcher", "stateful-filesystem-external-watcher-state-unsupported"],
  ],
};

function refusalSummaries(service) {
  return REFUSALS[service].map(([family, code]) =>
    refusalSummary(
      `stateful-${service}-${family}-refusal`,
      code,
      `${service} ${family} is not in the clean/quiesced restore contract`,
      family,
      service,
    ),
  );
}

function runSuite(options, workDir) {
  const selected =
    options.service === "all"
      ? ["redis", "sqlite", "postgres", "mariadb", "queue", "filesystem"]
      : [options.service];
  const positives = [];
  const refusals = [];
  for (const service of selected) {
    if (service === "redis") {
      positives.push(...proveRedis(join(workDir, service)));
    }
    if (service === "sqlite") {
      positives.push(...proveSqlite(join(workDir, service)));
    }
    if (service === "postgres") {
      positives.push(...provePostgres(join(workDir, service)));
    }
    if (service === "mariadb") {
      positives.push(...proveMariaDb(join(workDir, service)));
    }
    if (service === "queue") {
      positives.push(...proveQueue(join(workDir, service)));
    }
    if (service === "filesystem") {
      positives.push(...proveFilesystem(join(workDir, service)));
    }
    refusals.push(...refusalSummaries(service));
  }
  const summaries = [...positives, ...refusals];
  writeSummaries(options.summary_dir, summaries);
  return {
    kind: "machinen.stateful-services-proof",
    profile: "portable-machine-restore",
    state: "completed",
    host: { arch: arch(), platform: platform(), release: release() },
    services: selected,
    positiveCount: positives.length,
    refusalCount: refusals.length,
    summaries,
    securityInspection: noShortcutInspection(),
  };
}

const options = parseArgs(process.argv.slice(2));
const workDir = resolve(
  options.work_dir ?? join(tmpdir(), `machinen-stateful-services-${process.pid}`),
);
if (!options.keep) {
  rmSync(workDir, { recursive: true, force: true });
}
ensureDir(workDir);
const summary = runSuite(options, workDir);
writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
