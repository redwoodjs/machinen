import type {
  MoveDescriptor,
  MovePidGraphNode,
  NativeProcessImageRefusal,
  VmHandle,
} from "@machinen/runtime";
import { basename } from "node:path";
import {
  listeningTcpPortCheckCommand,
  safeAbsolutePath,
  shellQuote,
} from "./move-preflight-helpers.ts";
import type { MoveLoadDirectLoader } from "./move-rendezvous.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type MovePostgresClusterState = NonNullable<MoveCapture["postgresClusterState"]>;

export async function readMovePostgresClusterStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["postgresClusterState"]> {
  const parsed = parsePostgresArgs(node);
  if (
    !parsed ||
    resourcePlan.resources.filter((resource) => resource.kind === "socket").length < 1
  ) {
    return undefined;
  }
  const result = await vm.execRaw(postgresClusterPreflightCommand(parsed), {
    execTimeoutMs: 30_000,
  });
  return result.exitCode === 0 ? parsePostgresClusterPreflight(result.stdout) : undefined;
}

export async function runMoveTargetPostgresClusterLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const state = descriptor.resourcePlan?.capture?.postgresClusterState;
  const executable = state?.packageIdentity.executable ?? "/usr/lib/postgresql/15/bin/postgres";
  const result = await vm.execRaw(postgresClusterLoaderCommand(state), { execTimeoutMs: 120_000 });
  const patch = movePostgresPatchFromOutput(result);
  const refusals = movePostgresLoaderRefusals(patch);
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-native-postgres-idle-clean-cluster-loader",
    executable,
    argv: state
      ? [executable, "-D", state.dataDir, "-p", String(state.port), "-h", state.bindAddress]
      : [executable],
    targetPid: parseLoadPid(result.stdout),
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

export function parsePostgresArgs(
  node: MovePidGraphNode,
): { dataDir: string; port: number; bindAddress: "127.0.0.1" } | undefined {
  if (
    moveCommandName(node) !== "postgres" ||
    node.exe !== "/usr/lib/postgresql/15/bin/postgres" ||
    node.argv.length !== 7
  ) {
    return undefined;
  }
  const dataDir = node.argv[2];
  const port = Number(node.argv[4]);
  const bindAddress = node.argv[6];
  return node.argv[1] === "-D" &&
    node.argv[3] === "-p" &&
    node.argv[5] === "-h" &&
    bindAddress === "127.0.0.1" &&
    dataDir?.startsWith("/") &&
    safeAbsolutePath(dataDir) &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536
    ? { dataDir, port, bindAddress }
    : undefined;
}

export function parsePostgresClusterPreflight(stdout: string): MoveCapture["postgresClusterState"] {
  try {
    const fields = new Map<string, string>();
    for (const line of stdout.trim().split("\n")) {
      const index = line.indexOf("=");
      if (index > 0) {
        fields.set(line.slice(0, index), line.slice(index + 1));
      }
    }
    const port = Number(fields.get("port"));
    const treeEntryCount = Number(fields.get("treeEntryCount"));
    const ownerUid = Number(fields.get("ownerUid"));
    const ownerGid = Number(fields.get("ownerGid"));
    const runtimeState = {
      processShape: "postmaster-plus-standard-background-workers" as const,
      activeExternalClients: numberField(fields, "activeExternalClients"),
      nonIdleUserBackends: numberField(fields, "nonIdleUserBackends"),
      preparedTransactions: numberField(fields, "preparedTransactions"),
      replicationSlots: numberField(fields, "replicationSlots"),
      nonDefaultTablespaces: numberField(fields, "nonDefaultTablespaces"),
      unloggedRelations: numberField(fields, "unloggedRelations"),
      tempFiles: numberField(fields, "tempFiles"),
      symlinkEscapes: numberField(fields, "symlinkEscapes"),
      extensionNativeLibraries: numberField(fields, "extensionNativeLibraries"),
    };
    if (
      !Number.isInteger(port) ||
      !Number.isInteger(treeEntryCount) ||
      !Number.isInteger(ownerUid) ||
      !Number.isInteger(ownerGid) ||
      fields.get("bindAddress") !== "127.0.0.1"
    ) {
      return undefined;
    }
    const state: MovePostgresClusterState = {
      port,
      bindAddress: "127.0.0.1",
      dataDir: requiredField(fields, "dataDir"),
      packageIdentity: {
        packageName: "postgresql-15",
        version: requiredField(fields, "packageVersion"),
        architecture: requiredField(fields, "packageArchitecture"),
        executable: "/usr/lib/postgresql/15/bin/postgres",
      },
      clientPackageIdentity: {
        packageName: "postgresql-client-15",
        version: requiredField(fields, "clientPackageVersion"),
        architecture: requiredField(fields, "clientPackageArchitecture"),
      },
      clusterIdentity: {
        pgVersion: requiredField(fields, "pgVersion"),
        dataDirOwnerUid: ownerUid,
        dataDirOwnerGid: ownerGid,
        dataDirMode: requiredField(fields, "dataDirMode"),
        treeEntryCount,
        treeDigest: requiredSha(fields, "treeDigest"),
        pgControlSha256: requiredSha(fields, "pgControlSha256"),
        postgresqlConfSha256: requiredSha(fields, "postgresqlConfSha256"),
        pgHbaConfSha256: requiredSha(fields, "pgHbaConfSha256"),
      },
      walState: {
        policy: "clean-checkpoint-required",
        pgWalDigest: requiredSha(fields, "pgWalDigest"),
        currentWalFiles: requiredField(fields, "currentWalFiles").split(",").filter(Boolean),
        checkpointEvidence: requiredField(fields, "checkpointEvidence"),
      },
      runtimeState,
      policy: "postgres-idle-clean-cluster-target-native-restart",
      capturedAt: new Date().toISOString(),
    };
    return state;
  } catch {
    return undefined;
  }
}

export function postgresClusterLoaderCommand(state: MovePostgresClusterState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tpostgres-idle-clean-cluster\\trefused\\tmissing-postgres-cluster-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-postgres-loader-$$.log";
  const listenCheck = listeningTcpPortCheckCommand(state.port);
  return `set -eu
patch=postgres-idle-clean-cluster
log=${shellQuote(log)}
data_dir=${shellQuote(state.dataDir)}
if [ ! -x /usr/lib/postgresql/15/bin/postgres ] || [ ! -x /usr/lib/postgresql/15/bin/pg_isready ] || [ ! -x /usr/lib/postgresql/15/bin/psql ]; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tmissing-postgres-binary\n'
  exit 2
fi
server_pkg=$(dpkg-query -W -f='\${Version}\t\${Architecture}' postgresql-15 2>/dev/null || true)
client_pkg=$(dpkg-query -W -f='\${Version}\t\${Architecture}' postgresql-client-15 2>/dev/null || true)
server_version=$(printf '%s' "$server_pkg" | cut -f1)
client_version=$(printf '%s' "$client_pkg" | cut -f1)
if [ "$server_version" != ${shellQuote(state.packageIdentity.version)} ] || [ "$client_version" != ${shellQuote(state.clientPackageIdentity.version)} ]; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tpackage-mismatch\n'
  exit 2
fi
if [ ! -d "$data_dir" ] || [ -L "$data_dir" ]; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tmissing-data-dir\n'
  exit 2
fi
if [ -e "$data_dir/postmaster.pid" ]; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tstale-postmaster-pid\n'
  exit 2
fi
if find "$data_dir" -type l -print -quit | grep -q .; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tsymlink-escape\n'
  exit 2
fi
if find "$data_dir" -path '*/pgsql_tmp/*' -type f -print -quit | grep -q .; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\ttemp-files\n'
  exit 2
fi
owner_uid=$(stat -c %u "$data_dir")
owner_gid=$(stat -c %g "$data_dir")
owner_mode=$(stat -c %a "$data_dir")
if [ "$owner_uid" != ${shellQuote(String(state.clusterIdentity.dataDirOwnerUid))} ] || [ "$owner_gid" != ${shellQuote(String(state.clusterIdentity.dataDirOwnerGid))} ] || [ "$owner_mode" != ${shellQuote(state.clusterIdentity.dataDirMode)} ]; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\towner-mode-mismatch\n'
  exit 2
fi
pg_version=$(tr -d '\r\n' <"$data_dir/PG_VERSION")
pg_control_sha=$(sha256sum "$data_dir/global/pg_control" | cut -d' ' -f1)
postgresql_conf_sha=$(sha256sum "$data_dir/postgresql.conf" | cut -d' ' -f1)
pg_hba_sha=$(sha256sum "$data_dir/pg_hba.conf" | cut -d' ' -f1)
if [ "$pg_version" != ${shellQuote(state.clusterIdentity.pgVersion)} ] || [ "$pg_control_sha" != ${shellQuote(state.clusterIdentity.pgControlSha256)} ] || [ "$postgresql_conf_sha" != ${shellQuote(state.clusterIdentity.postgresqlConfSha256)} ] || [ "$pg_hba_sha" != ${shellQuote(state.clusterIdentity.pgHbaConfSha256)} ]; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tconfig-identity-mismatch\n'
  exit 2
fi
find "$data_dir" -xdev -printf '%P\t%y\t%m\t%u\t%g\t%s\t%l\n' | grep -Ev '^(postmaster[.]pid|postmaster[.]opts|pg_stat/|pg_stat_tmp/)' | LC_ALL=C sort >/tmp/machinen-pg-tree-$$.txt
tree_count=$(wc -l </tmp/machinen-pg-tree-$$.txt | tr -d ' ')
tree_digest=$(sha256sum /tmp/machinen-pg-tree-$$.txt | cut -d' ' -f1)
if [ "$tree_count" != ${shellQuote(String(state.clusterIdentity.treeEntryCount))} ] || [ "$tree_digest" != ${shellQuote(state.clusterIdentity.treeDigest)} ]; then
  printf 'TREE_IDENTITY\t%s\t%s\texpected\t%s\t%s\n' "$tree_count" "$tree_digest" ${shellQuote(String(state.clusterIdentity.treeEntryCount))} ${shellQuote(state.clusterIdentity.treeDigest)}
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tdata-dir-identity-mismatch\n'
  rm -f /tmp/machinen-pg-tree-$$.txt
  exit 2
fi
rm -f /tmp/machinen-pg-tree-$$.txt
find "$data_dir/pg_wal" -maxdepth 1 -type f -printf '%f\t%s\n' | LC_ALL=C sort >/tmp/machinen-pg-wal-$$.txt
wal_digest=$(sha256sum /tmp/machinen-pg-wal-$$.txt | cut -d' ' -f1)
wal_files=$(cut -f1 /tmp/machinen-pg-wal-$$.txt | paste -sd, -)
rm -f /tmp/machinen-pg-wal-$$.txt
checkpoint_evidence=$(/usr/lib/postgresql/15/bin/pg_controldata "$data_dir" 2>/dev/null | awk -F: '/Database cluster state|Latest checkpoint/ { gsub(/^[ \t]+/, "", $2); printf "%s=%s;", $1, $2 }')
if [ "$wal_digest" != ${shellQuote(state.walState.pgWalDigest)} ] || [ "$wal_files" != ${shellQuote(state.walState.currentWalFiles.join(","))} ] || [ "$checkpoint_evidence" != ${shellQuote(state.walState.checkpointEvidence)} ]; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\twal-checkpoint-identity-mismatch\n'
  exit 2
fi
if ${listenCheck}; then
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tport-in-use\n'
  exit 2
fi
setsid su -s /bin/sh postgres -c "cd ${shellQuote(state.dataDir)} && exec /usr/lib/postgresql/15/bin/postgres -D ${shellQuote(state.dataDir)} -p ${shellQuote(String(state.port))} -h 127.0.0.1 >$log 2>&1" </dev/null >/dev/null 2>&1 &
starter=$!
ready=0
for _ in $(seq 1 80); do
  if /usr/lib/postgresql/15/bin/pg_isready -h 127.0.0.1 -p ${shellQuote(String(state.port))} >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! kill -0 "$starter" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tstart-failed\n'
    exit 2
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$starter" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tnot-ready\n'
  exit 2
fi
pid=""
for d in /proc/[0-9]*; do
  exe=$(readlink "$d/exe" 2>/dev/null || true)
  [ "$exe" = /usr/lib/postgresql/15/bin/postgres ] || continue
  cmd=$(tr '\\000' ' ' <"$d/cmdline" 2>/dev/null || true)
  case "$cmd" in *"$data_dir"*) pid=\${d##*/}; break;; esac
done
if [ -z "$pid" ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tpostmaster-pid-missing\n'
  exit 2
fi
select_one=$(/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p ${shellQuote(String(state.port))} -U postgres -d postgres -Atc 'select 1' 2>/dev/null || true)
if [ "$select_one" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tpostgres-idle-clean-cluster\trefused\tselect-one-failed\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-postgres-idle-clean-cluster-started\n'
printf 'PATCH\tpostgres-idle-clean-cluster\tready\t%s\t%s\n' ${shellQuote(String(state.port))} ${shellQuote(state.clusterIdentity.treeDigest)}
`;
}

function postgresClusterPreflightCommand(parsed: {
  dataDir: string;
  port: number;
  bindAddress: "127.0.0.1";
}): string {
  const dataDir = shellQuote(parsed.dataDir);
  return `set -eu
data_dir=${dataDir}
port=${shellQuote(String(parsed.port))}
[ -d "$data_dir" ]
[ ! -L "$data_dir" ]
[ -x /usr/lib/postgresql/15/bin/postgres ]
[ -x /usr/lib/postgresql/15/bin/psql ]
server_pkg=$(dpkg-query -W -f='\${Version}\t\${Architecture}' postgresql-15)
client_pkg=$(dpkg-query -W -f='\${Version}\t\${Architecture}' postgresql-client-15)
owner_uid=$(stat -c %u "$data_dir")
owner_gid=$(stat -c %g "$data_dir")
owner_mode=$(stat -c %a "$data_dir")
pg_version=$(tr -d '\r\n' <"$data_dir/PG_VERSION")
pg_control_sha=$(sha256sum "$data_dir/global/pg_control" | cut -d' ' -f1)
postgresql_conf_sha=$(sha256sum "$data_dir/postgresql.conf" | cut -d' ' -f1)
pg_hba_sha=$(sha256sum "$data_dir/pg_hba.conf" | cut -d' ' -f1)
find "$data_dir" -xdev -printf '%P\t%y\t%m\t%u\t%g\t%s\t%l\n' | grep -Ev '^(postmaster[.]pid|postmaster[.]opts|pg_stat/|pg_stat_tmp/)' | LC_ALL=C sort >/tmp/machinen-pg-tree-$$.txt
tree_count=$(wc -l </tmp/machinen-pg-tree-$$.txt | tr -d ' ')
tree_digest=$(sha256sum /tmp/machinen-pg-tree-$$.txt | cut -d' ' -f1)
find "$data_dir/pg_wal" -maxdepth 1 -type f -printf '%f\t%s\n' | LC_ALL=C sort >/tmp/machinen-pg-wal-$$.txt
wal_digest=$(sha256sum /tmp/machinen-pg-wal-$$.txt | cut -d' ' -f1)
wal_files=$(cut -f1 /tmp/machinen-pg-wal-$$.txt | paste -sd, -)
checkpoint_evidence=$(/usr/lib/postgresql/15/bin/pg_controldata "$data_dir" 2>/dev/null | awk -F: '/Database cluster state|Latest checkpoint/ { gsub(/^[ \t]+/, "", $2); printf "%s=%s;", $1, $2 }')
[ -n "$checkpoint_evidence" ]
metrics=$(/usr/lib/postgresql/15/bin/psql -h 127.0.0.1 -p "$port" -U postgres -d postgres -At <<'SQL'
select 'activeExternalClients=' || count(*) from pg_stat_activity where pid <> pg_backend_pid() and backend_type = 'client backend';
select 'nonIdleUserBackends=' || count(*) from pg_stat_activity where pid <> pg_backend_pid() and backend_type = 'client backend' and state is distinct from 'idle';
select 'preparedTransactions=' || count(*) from pg_prepared_xacts;
select 'replicationSlots=' || count(*) from pg_replication_slots;
select 'nonDefaultTablespaces=' || count(*) from pg_tablespace where spcname not in ('pg_default','pg_global');
select 'unloggedRelations=' || count(*) from pg_class where relpersistence = 'u';
select 'extensionNativeLibraries=' || count(*) from pg_extension where extname <> 'plpgsql';
SQL
)
pg_control_sha=$(sha256sum "$data_dir/global/pg_control" | cut -d' ' -f1)
find "$data_dir" -xdev -printf '%P\t%y\t%m\t%u\t%g\t%s\t%l\n' | grep -Ev '^(postmaster[.]pid|postmaster[.]opts|pg_stat/|pg_stat_tmp/)' | LC_ALL=C sort >/tmp/machinen-pg-tree-$$.txt
tree_count=$(wc -l </tmp/machinen-pg-tree-$$.txt | tr -d ' ')
tree_digest=$(sha256sum /tmp/machinen-pg-tree-$$.txt | cut -d' ' -f1)
find "$data_dir/pg_wal" -maxdepth 1 -type f -printf '%f\t%s\n' | LC_ALL=C sort >/tmp/machinen-pg-wal-$$.txt
wal_digest=$(sha256sum /tmp/machinen-pg-wal-$$.txt | cut -d' ' -f1)
wal_files=$(cut -f1 /tmp/machinen-pg-wal-$$.txt | paste -sd, -)
checkpoint_evidence=$(/usr/lib/postgresql/15/bin/pg_controldata "$data_dir" 2>/dev/null | awk -F: '/Database cluster state|Latest checkpoint/ { gsub(/^[ \t]+/, "", $2); printf "%s=%s;", $1, $2 }')
temp_files=$(find "$data_dir" -path '*/pgsql_tmp/*' -type f | wc -l | tr -d ' ')
symlink_escapes=$(find "$data_dir" -type l -print | wc -l | tr -d ' ')
printf 'port=%s\n' "$port"
printf 'bindAddress=127.0.0.1\n'
printf 'dataDir=%s\n' "$data_dir"
printf 'packageVersion=%s\npackageArchitecture=%s\n' "$(printf '%s' "$server_pkg" | cut -f1)" "$(printf '%s' "$server_pkg" | cut -f2)"
printf 'clientPackageVersion=%s\nclientPackageArchitecture=%s\n' "$(printf '%s' "$client_pkg" | cut -f1)" "$(printf '%s' "$client_pkg" | cut -f2)"
printf 'ownerUid=%s\nownerGid=%s\ndataDirMode=%s\npgVersion=%s\n' "$owner_uid" "$owner_gid" "$owner_mode" "$pg_version"
printf 'pgControlSha256=%s\npostgresqlConfSha256=%s\npgHbaConfSha256=%s\n' "$pg_control_sha" "$postgresql_conf_sha" "$pg_hba_sha"
printf 'treeEntryCount=%s\ntreeDigest=%s\npgWalDigest=%s\ncurrentWalFiles=%s\ncheckpointEvidence=%s\n' "$tree_count" "$tree_digest" "$wal_digest" "$wal_files" "$checkpoint_evidence"
printf '%s\n' "$metrics"
printf 'tempFiles=%s\nsymlinkEscapes=%s\n' "$temp_files" "$symlink_escapes"
rm -f /tmp/machinen-pg-tree-$$.txt /tmp/machinen-pg-wal-$$.txt
`;
}

function movePostgresPatchFromOutput(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): MoveLoadDirectLoader["patch"] {
  const state =
    result.exitCode === 0 && result.stdout.includes("PATCH\tpostgres-idle-clean-cluster\tready")
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

function movePostgresLoaderRefusals(
  patch: MoveLoadDirectLoader["patch"],
): NativeProcessImageRefusal[] {
  return patch?.state === "ready"
    ? []
    : [
        {
          code: "target-process-context-unsupported",
          message: "target PostgreSQL idle clean-cluster loader failed",
          detail: { patch },
        },
      ];
}

function parseLoadPid(stdout: string): number | undefined {
  const pid = Number(
    stdout
      .split("\n")
      .find((row) => row.startsWith("LOAD_PID\t"))
      ?.split("\t")[1],
  );
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function parseLogPath(stdout: string): string | undefined {
  return stdout
    .trim()
    .split("\n")
    .find((row) => row.startsWith("LOAD_LOG\t"))
    ?.split("\t")[1];
}

function numberField(fields: Map<string, string>, name: string): 0 {
  const value = Number(fields.get(name));
  if (value !== 0) {
    throw new Error(`postgres preflight ${name} must be 0`);
  }
  return 0;
}

function requiredField(fields: Map<string, string>, name: string): string {
  const value = fields.get(name);
  if (!value) {
    throw new Error(`missing postgres preflight field ${name}`);
  }
  return value;
}

function requiredSha(fields: Map<string, string>, name: string): string {
  const value = requiredField(fields, name);
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`invalid postgres sha field ${name}`);
  }
  return value;
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}
