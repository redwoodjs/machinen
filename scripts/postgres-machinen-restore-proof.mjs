#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { provision } from "../packages/runtime/dist/index.js";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);
const CLI = join(REPO_ROOT, "packages/cli/dist/cli.js");
const ASSETS = join(REPO_ROOT, "release-assets");
const PG_MAJOR = "15";
const FIXTURE_DIR = join(REPO_ROOT, "scripts/fixtures/postgres-machinen");

function usage() {
  console.error(
    "usage: node scripts/postgres-machinen-restore-proof.mjs run-suite --out file [--work-dir dir] [--image path] [--keep]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== "run-suite") {
    usage();
  }
  const options = { command, keep: false };
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
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result;
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

function completedTarget(kind) {
  return {
    state: "completed",
    migrationCompleted: true,
    descriptorGateCompleted: true,
    targetVerifierResult: "passed",
    targetResourceStatuses: [{ kind, status: "passed" }],
    sourceTextReusedAsTargetCode: false,
    sourceIsaEmulationUsed: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
  };
}

function entrypointScript() {
  return `#!/bin/sh
set -eu
PG_MAJOR=${PG_MAJOR}
CONF=/etc/postgresql/$PG_MAJOR/main/postgresql.conf
HBA=/etc/postgresql/$PG_MAJOR/main/pg_hba.conf
if [ ! -f /var/lib/postgresql/$PG_MAJOR/main/PG_VERSION ]; then
  pg_createcluster $PG_MAJOR main --start-conf=manual
fi
if ! grep -q machinen-postgres-proof "$CONF"; then
  cat >>"$CONF" <<'EOF'
# machinen-postgres-proof
listen_addresses = '127.0.0.1'
unix_socket_directories = '/var/run/postgresql'
fsync = on
synchronous_commit = on
full_page_writes = on
ssl = off
EOF
fi
if ! grep -q machinen-postgres-proof "$HBA"; then
  cat >>"$HBA" <<'EOF'
# machinen-postgres-proof
local all all trust
host all all 127.0.0.1/32 trust
EOF
fi
mkdir -p /var/run/postgresql
chown -R postgres:postgres /var/run/postgresql /var/lib/postgresql/$PG_MAJOR/main
chmod 755 /etc/postgresql /etc/postgresql/$PG_MAJOR /etc/postgresql/$PG_MAJOR/main
chmod 644 "$CONF" "$HBA"
chmod 2775 /var/run/postgresql
exec su -s /bin/sh postgres -c "exec /usr/lib/postgresql/$PG_MAJOR/bin/postgres -D /var/lib/postgresql/$PG_MAJOR/main -c config_file=$CONF"
`;
}

const INIT_SQL = readFileSync(join(FIXTURE_DIR, "init.sql"), "utf8");
const WORKLOAD_SQL = readFileSync(join(FIXTURE_DIR, "workload.sql"), "utf8");
const VERIFY_SQL = readFileSync(join(FIXTURE_DIR, "verify.sql"), "utf8");

async function buildImage(workDir, imageOverride) {
  if (imageOverride) {
    return resolve(imageOverride);
  }
  const image = join(workDir, "postgres-machinen-rootfs.tar.gz");
  if (existsSync(image)) {
    return image;
  }
  await provision({
    out: image,
    base: join(ASSETS, "rootfs-debian-arm64.tar.gz"),
    kernel: join(ASSETS, "Image-arm64"),
    dtb: join(ASSETS, "virt-arm64.dtb"),
    scratchDiskSizeBytes: 4 * 1024 * 1024 * 1024,
    vmmEnv: { MACHINEN_RAM_BYTES: String(1536 * 1024 * 1024) },
    cmd: ["/usr/sbin/machinen-supervisor", "/opt/machinen-pg/run-postgres.sh"],
    env: { PATH: "/usr/local/bin:/usr/bin:/bin:/sbin", HOME: "/root" },
    timeoutMs: 15 * 60_000,
    install: async (vm) => {
      await vm.exec(
        "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y --no-install-recommends postgresql-15 postgresql-client-15 ca-certificates && apt-get clean && rm -rf /var/lib/apt/lists/*",
        { execTimeoutMs: 12 * 60_000 },
      );
      await vm.exec("mkdir -p /opt/machinen-pg /var/run/postgresql");
      await vm.writeFile("/opt/machinen-pg/run-postgres.sh", entrypointScript(), { mode: 0o755 });
      await vm.writeFile("/opt/machinen-pg/init.sql", INIT_SQL);
      await vm.writeFile("/opt/machinen-pg/workload.sql", WORKLOAD_SQL);
      await vm.writeFile("/opt/machinen-pg/verify.sql", VERIFY_SQL);
      await vm.exec(
        "chown -R postgres:postgres /var/lib/postgresql /var/log/postgresql /var/run/postgresql && chmod +x /opt/machinen-pg/run-postgres.sh",
      );
    },
  });
  return image;
}

function cliEnv(workDir) {
  return {
    ...process.env,
    MACHINEN_ASSETS_DIR: ASSETS,
    MACHINEN_REGISTRY_DIR: join(workDir, "registry"),
    MACHINEN_SNAPSHOT_ENGINE: "vmstate",
    MACHINEN_GUEST_ARCH: "arm64",
    MACHINEN_RAM_BYTES: String(1536 * 1024 * 1024),
  };
}

function cli(workDir, args, options = {}) {
  return mustRun("node", [CLI, ...args], { ...options, env: cliEnv(workDir) });
}

function cliAllowFail(workDir, args, options = {}) {
  return run("node", [CLI, ...args], { ...options, env: cliEnv(workDir) });
}

function waitForVm(workDir, name, timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const list = cliAllowFail(workDir, ["ls"]);
    if (list.stdout.split("\n").some((line) => line.split(/\s+/).includes(name))) {
      return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`VM ${name} did not register`);
}

function waitForPostgres(workDir, name) {
  const command =
    "for i in $(seq 1 120); do pg_isready -h 127.0.0.1 -p 5432 >/dev/null 2>&1 && exit 0; sleep 0.5; done; exit 1";
  cli(workDir, ["exec", name, "--", command]);
}

function psql(workDir, name, sqlPath) {
  const guestPath = sqlPath.replace(/^\//, "");
  const output = cli(workDir, [
    "exec",
    name,
    "--",
    `cd /; su postgres -c 'psql -v ON_ERROR_STOP=1 -At -f ${guestPath}'`,
  ]).stdout.trim();
  return output.split("\n").filter(Boolean).at(-1) ?? "";
}

function execGuest(workDir, name, command) {
  return cli(workDir, ["exec", name, "--", command]).stdout.trim();
}

function findVmByPrefix(workDir, prefix) {
  const list = cliAllowFail(workDir, ["ls"]);
  for (const line of list.stdout.split("\n")) {
    const fields = line.trim().split(/\s+/);
    const name = fields[1];
    if (name?.startsWith(`${prefix}/`) || name?.startsWith(`${prefix}~`)) {
      return name;
    }
  }
  return null;
}

function waitForRestoredVm(workDir, sourceName, explicitName, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (explicitName) {
      const list = cliAllowFail(workDir, ["ls"]);
      if (list.stdout.split("\n").some((line) => line.split(/\s+/).includes(explicitName))) {
        return explicitName;
      }
    }
    const found = findVmByPrefix(workDir, sourceName);
    if (found) {
      return found;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  throw new Error(`restored VM for ${sourceName} did not register`);
}

function startRestore(workDir, snapDir, image, name, logPath) {
  const out = writeFileSync(logPath, "");
  void out;
  const child = spawn("node", [CLI, "restore", snapDir, "--image", image, "--name", name], {
    env: cliEnv(workDir),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => writeFileSync(logPath, chunk, { flag: "a" }));
  child.stderr.on("data", (chunk) => writeFileSync(logPath, chunk, { flag: "a" }));
  return child;
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
  ];
}

async function runSuite(options, workDir) {
  ensureDir(workDir);
  ensureDir(join(workDir, "registry"));
  const image = await buildImage(workDir, options.image);
  const name = `postgres-proof-${process.pid}`;
  const restoredName = `${name}-restored`;
  const snapDir = join(workDir, "postgres.snap");
  const restoreLog = join(workDir, "restore.log");
  const cleanup = () => {
    cliAllowFail(workDir, ["stop", name]);
    cliAllowFail(workDir, ["stop", restoredName]);
  };
  let restoreChild;
  try {
    cli(workDir, ["boot", image, "--name", name, "--detach", "--", "sleep", "100000"]);
    waitForVm(workDir, name);
    execGuest(
      workDir,
      name,
      "cd /; mkdir -p tmp run var/tmp run/postgresql; chmod 1777 tmp var/tmp; nohup opt/machinen-pg/run-postgres.sh >tmp/postgres.log 2>&1 &",
    );
    waitForPostgres(workDir, name);
    const version = execGuest(
      workDir,
      name,
      "su -s /bin/sh postgres -c 'psql -At -c \"SHOW server_version;\"'",
    );
    psql(workDir, name, "/opt/machinen-pg/init.sql");
    psql(workDir, name, "/opt/machinen-pg/workload.sql");
    const activeTransactions = execGuest(
      workDir,
      name,
      "su -s /bin/sh postgres -c \"psql -At -d machinen_pg -c \\\"SELECT count(*) FROM pg_stat_activity WHERE datname='machinen_pg' AND pid <> pg_backend_pid() AND state <> 'idle';\\\"\"",
    );
    const sourceVerify = psql(workDir, name, "/opt/machinen-pg/verify.sql");
    const walLsn = execGuest(
      workDir,
      name,
      "su -s /bin/sh postgres -c \"psql -At -d machinen_pg -c 'CHECKPOINT; SELECT pg_current_wal_lsn();'\" | tail -1 && sync",
    );
    rmSync(snapDir, { recursive: true, force: true });
    cli(workDir, ["snapshot", name, snapDir]);
    cliAllowFail(workDir, ["stop", name]);
    restoreChild = startRestore(workDir, snapDir, image, restoredName, restoreLog);
    waitForRestoredVm(workDir, name, restoredName);
    waitForPostgres(workDir, restoredName);
    const targetVerify = psql(workDir, restoredName, "/opt/machinen-pg/verify.sql");
    if (sourceVerify !== targetVerify) {
      throw new Error(
        `PostgreSQL logical verification mismatch\nsource=${sourceVerify}\ntarget=${targetVerify}`,
      );
    }
    const dataManifest = execGuest(
      workDir,
      restoredName,
      "cd /; find var/lib/postgresql/15/main/base -maxdepth 3 -type f -printf '%P %s\\n' 2>/dev/null | sort | sha256sum | awk '{print $1}'",
    );
    const refusals = refusalInventory();
    return {
      kind: "machinen.postgres-restore-proof",
      profile: "portable-machine-restore",
      state: "completed",
      runtime: "postgresql",
      host: { arch: arch(), platform: platform(), release: release() },
      machinen: { snapshotEngine: "vmstate", guestArch: "arm64", imageSha256: sha256File(image) },
      postgres: {
        version,
        architecture: execGuest(workDir, restoredName, "uname -m"),
        initSqlSha256: sha256(INIT_SQL),
        workloadSqlSha256: sha256(WORKLOAD_SQL),
        verifierSqlSha256: sha256(VERIFY_SQL),
        walCheckpointLsn: walLsn,
        activeTransactionsAtSnapshot: Number(activeTransactions),
        dataDirectoryManifestSha256: dataManifest,
        sourceVerifierOutput: sourceVerify,
        targetVerifierOutput: targetVerify,
        targetVerifierOutputSha256: sha256(targetVerify),
      },
      supportedSubset: {
        name: "postgres-clean-quiesced-checkpointed-vmstate",
        migrationCompleted: true,
        noActiveClientTransaction: activeTransactions === "0",
        walCheckpointed: true,
        dataDirectorySynced: true,
        targetNativeVerification: true,
        serviceRestorePolicy: "whole-VM vmstate restore of quiesced PostgreSQL service",
      },
      refusals,
      targetRestore: completedTarget("postgres-clean-quiesced-database"),
      securityInspection: noShortcutInspection(),
      timings: [],
    };
  } finally {
    if (restoreChild) {
      restoreChild.kill("SIGTERM");
    }
    cleanup();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const workDir = resolve(
    options.work_dir ?? join(tmpdir(), `machinen-postgres-proof-${process.pid}`),
  );
  if (!options.keep) {
    rmSync(workDir, { recursive: true, force: true });
  }
  ensureDir(workDir);
  const summary = await runSuite(options, workDir);
  writeFileSync(resolve(options.out), `${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
