# PostgreSQL move envelope ladder

This document defines the first PostgreSQL-specific `machinen move` support target. It does not claim generic PostgreSQL process teleportation.

## Product boundary

The user-facing command remains:

```sh
machinen move save <source-vm> <postgres-pid> pg.bundle
machinen move load <target-vm> pg.bundle
```

The implementation must be an explicit PostgreSQL envelope inside `machinen move`:

- same Machinen Debian base;
- target-native Debian PostgreSQL binaries;
- no source-ISA emulation success;
- no `pg_dump`/restore product path;
- no generic process, VM, ELF, runtime, shared-memory, socket, or arbitrary PostgreSQL restore claim;
- no target loader launch until every PostgreSQL safety gate passes;
- no metadata-only success: support needs visible target `psql` evidence.

## Observed proof VM shape

A proof-provisioned PostgreSQL 15 cluster started with:

```sh
/usr/lib/postgresql/15/bin/initdb -D /tmp/pgdata-proof --auth=trust --no-locale
/usr/lib/postgresql/15/bin/postgres -D /tmp/pgdata-proof -p 8159 -h 127.0.0.1
```

Inspection artifacts are retained under `/tmp/postgres-move-ladder-inspect` during the goal run. The observed shape includes:

- postmaster plus child processes: checkpointer, background writer, walwriter, autovacuum launcher, logical replication launcher;
- TCP listener on `127.0.0.1:8159`;
- fd table with sockets, pipes, log file, `/dev/kmsg`, and stdio;
- SYSV shared-memory mappings plus `/dev/zero (deleted)` shared mapping;
- data directory `/tmp/pgdata-proof` owned by `postgres:postgres` with mode `700`;
- runtime files `postmaster.pid` and `postmaster.opts`;
- `PG_VERSION`, `postgresql.conf`, `pg_hba.conf`, and `global/pg_control` identities;
- WAL segment under `pg_wal`;
- SQL-level safety counters for prepared transactions, replication slots, non-default tablespaces, and unlogged relations.

Because of this shape, the first support envelope is a target-native safe-boundary restart envelope, not live kernel process teleportation.

## First support envelope

Name: `postgres-idle-clean-cluster`.

Accepted process shape:

- root pid is `/usr/lib/postgresql/15/bin/postgres`;
- argv matches `postgres -D DATA_DIR -p PORT -h 127.0.0.1`;
- cluster is proof-provisioned PostgreSQL 15 on same Machinen Debian base;
- cluster has no external active clients;
- no open user transaction or non-idle user backend;
- clean checkpoint or equivalent safe boundary evidence is present;
- no prepared transactions;
- no replication slots;
- no non-default tablespaces;
- no symlink escape inside the data directory;
- no unlogged relations for the first support row;
- no temp files or unsafe transient state;
- no extension/native-library uncertainty beyond the base PostgreSQL package;
- port is bound to loopback only and is available on target before load.

Target success evidence:

- target-native PostgreSQL starts from the validated envelope;
- `psql -h 127.0.0.1 -p PORT -U postgres -d postgres -Atc 'select 1'` returns `1`;
- loader returns a target pid for the target-native postmaster.

## Implemented `postgresClusterState`

The runtime move descriptor includes `resourcePlan.capture.postgresClusterState` for the accepted envelope. The state includes:

```ts
interface MovePostgresClusterState {
  port: number;
  bindAddress: "127.0.0.1";
  dataDir: string;
  packageIdentity: {
    packageName: "postgresql-15";
    version: string;
    architecture: string;
    executable: "/usr/lib/postgresql/15/bin/postgres";
  };
  clientPackageIdentity: {
    packageName: "postgresql-client-15";
    version: string;
    architecture: string;
  };
  clusterIdentity: {
    pgVersion: string;
    dataDirOwnerUid: number;
    dataDirOwnerGid: number;
    dataDirMode: string;
    treeEntryCount: number;
    treeDigest: string;
    pgControlSha256: string;
    postgresqlConfSha256: string;
    pgHbaConfSha256: string;
  };
  walState: {
    policy: "clean-checkpoint-required";
    pgWalDigest: string;
    currentWalFiles: string[];
    checkpointEvidence: string;
  };
  runtimeState: {
    processShape: "postmaster-plus-standard-background-workers";
    activeExternalClients: 0;
    nonIdleUserBackends: 0;
    preparedTransactions: 0;
    replicationSlots: 0;
    nonDefaultTablespaces: 0;
    unloggedRelations: 0;
    tempFiles: 0;
    symlinkEscapes: 0;
    extensionNativeLibraries: 0;
  };
  policy: "postgres-idle-clean-cluster-target-native-restart";
  capturedAt: string;
}
```

The implementation intentionally omits `postgresClusterState` for unsupported capture shapes. Omission keeps `machinen move save` fail-closed through the existing resource-refusal path; no PostgreSQL target loader can run without this descriptor state.

## Target loader preflight order

The target loader must fail closed before launch in this order:

1. confirm descriptor has `postgresClusterState`;
2. confirm target PostgreSQL package and client package identities match the accepted policy;
3. confirm target executable path is target-native `/usr/lib/postgresql/15/bin/postgres`;
4. confirm target data directory path is safe and is not a symlink escape;
5. confirm target data directory/config identities match the descriptor;
6. confirm owner uid/gid and mode match the descriptor;
7. confirm WAL/checkpoint safety evidence still matches;
8. confirm no unsupported feature markers: prepared transactions, replication slots, non-default tablespaces, unlogged relations, temp files, extension/native-library uncertainty;
9. confirm target port is not already listening;
10. only then launch target-native PostgreSQL;
11. wait for readiness;
12. run visible target `psql SELECT 1` proof;
13. return `targetPid` and loader ready state.

The current loader uses target-native Debian PostgreSQL binaries and validates package identity, data directory ownership/mode, config hashes, portable data-directory tree identity, WAL file identity, checkpoint evidence, and target port availability before launch. It starts PostgreSQL only after those gates pass and only reports `targetPid` after `pg_isready` and `psql SELECT 1` succeed.

## Refusal gates

The PostgreSQL envelope must refuse with no target pid or no loader launch for:

- active external clients;
- open transactions;
- non-idle user backends;
- prepared transactions;
- replication slots;
- non-default tablespaces;
- symlink escapes inside the data directory or config paths;
- unlogged relations;
- temp files or unsafe transient state;
- extension/native-library uncertainty;
- dirty or unclean checkpoint/WAL state;
- missing target PostgreSQL package;
- mismatched target package version or architecture policy;
- changed data directory tree/config identity;
- changed owner/mode;
- target port conflict.

Local proof rows currently cover support and fail-closed behavior with retained JSON/timing evidence:

- `postgres-idle-cluster`: save/load accepted, target-native PostgreSQL starts, and target `psql SELECT 1` returns `1`.
- `postgres-refusal`: active client/non-idle backend shape omits `postgresClusterState`; save/load refuse and no loader starts.
- `unsafe-postgres-cluster-refusal`: prepared transaction, replication slot, non-default tablespace, unlogged relation, extension/native-library uncertainty, temp file, and symlink escape counters are non-zero and capture omits `postgresClusterState`; target loader refusals for changed config, port conflict, missing binary, package mismatch, stale `postmaster.pid`, owner/mode mismatch, data tree mismatch, and WAL/checkpoint mismatch all return no target pid.

Remote amd64 validation is not claimed yet. The recorded remote attempt reached Linux x86-64 VMM/gvproxy binaries but failed before matrix execution because the guest exec agent did not respond (`EXEC_AGENT_UNAVAILABLE` / `write EPIPE`).

## Non-goals for the first support row

- Preserving active client TCP sessions.
- Preserving open SQL transactions.
- Reconstructing PostgreSQL shared memory.
- Translating live arm64 postmaster or backend instruction/register state to amd64.
- Supporting arbitrary extensions or native libraries.
- Supporting tablespaces outside the data directory.
- Supporting `pg_dump`/restore as the move implementation.
