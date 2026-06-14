import type { MovePidGraphNode } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import {
  parsePostgresArgs,
  parsePostgresClusterPreflight,
  postgresClusterLoaderCommand,
} from "../move-postgres-envelope.ts";

const postgresNode: MovePidGraphNode = {
  pid: 2685,
  ppid: 1,
  command: "postgres",
  argv: [
    "/usr/lib/postgresql/15/bin/postgres",
    "-D",
    "/tmp/pgdata-proof",
    "-p",
    "8159",
    "-h",
    "127.0.0.1",
  ],
  cwd: "/tmp/pgdata-proof",
  exe: "/usr/lib/postgresql/15/bin/postgres",
};

const preflight = [
  "port=8159",
  "bindAddress=127.0.0.1",
  "dataDir=/tmp/pgdata-proof",
  "packageVersion=15.18-0+deb12u1",
  "packageArchitecture=arm64",
  "clientPackageVersion=15.18-0+deb12u1",
  "clientPackageArchitecture=arm64",
  "ownerUid=100",
  "ownerGid=102",
  "dataDirMode=700",
  "pgVersion=15",
  "pgControlSha256=a4acad8d03f61a85a1d5979af1488e423f86b45f60ee14f407c0c3beb02b720a",
  "postgresqlConfSha256=2b23995b2795b3ab778e9d3bb9104f917d93b5702f27ebd8ab5e6694fbccbf3a",
  "pgHbaConfSha256=bc4830d4b3b574118bda071ed29925815a9c3ba188165f7e05bf9ab66b71cc5e",
  "treeEntryCount=993",
  "treeDigest=c3f122ca9c608075d7526417d12f5ffa5a6d00aa72904f68c5727969ea3f2f99",
  "pgWalDigest=1111111111111111111111111111111111111111111111111111111111111111",
  "currentWalFiles=000000010000000000000001",
  "checkpointEvidence=Database cluster state=in production;Latest checkpoint location=0/1500708;",
  "activeExternalClients=0",
  "nonIdleUserBackends=0",
  "preparedTransactions=0",
  "replicationSlots=0",
  "nonDefaultTablespaces=0",
  "unloggedRelations=0",
  "extensionNativeLibraries=0",
  "tempFiles=0",
  "symlinkEscapes=0",
].join("\n");

describe("PostgreSQL move envelope capture parsing", () => {
  it("accepts the narrow postmaster argv shape", () => {
    expect(parsePostgresArgs(postgresNode)).toEqual({
      dataDir: "/tmp/pgdata-proof",
      port: 8159,
      bindAddress: "127.0.0.1",
    });
  });

  it("rejects unsupported bind addresses and unsafe data dirs", () => {
    expect(
      parsePostgresArgs({ ...postgresNode, argv: [...postgresNode.argv.slice(0, 6), "0.0.0.0"] }),
    ).toBeUndefined();
    expect(
      parsePostgresArgs({
        ...postgresNode,
        argv: [postgresNode.argv[0]!, "-D", "/tmp/../pgdata", "-p", "8159", "-h", "127.0.0.1"],
      }),
    ).toBeUndefined();
  });

  it("parses postgresClusterState for a zero-risk preflight", () => {
    const state = parsePostgresClusterPreflight(preflight);
    expect(state?.policy).toBe("postgres-idle-clean-cluster-target-native-restart");
    expect(state?.packageIdentity).toMatchObject({
      packageName: "postgresql-15",
      architecture: "arm64",
    });
    expect(state?.runtimeState).toMatchObject({
      activeExternalClients: 0,
      preparedTransactions: 0,
      extensionNativeLibraries: 0,
    });
  });

  it("omits postgresClusterState when any capture safety gate is non-zero", () => {
    for (const gate of [
      "activeExternalClients",
      "nonIdleUserBackends",
      "preparedTransactions",
      "replicationSlots",
      "nonDefaultTablespaces",
      "unloggedRelations",
      "extensionNativeLibraries",
      "tempFiles",
      "symlinkEscapes",
    ]) {
      expect(
        parsePostgresClusterPreflight(preflight.replace(`${gate}=0`, `${gate}=1`)),
      ).toBeUndefined();
    }
  });

  it("refuses missing loader state before launch", () => {
    expect(postgresClusterLoaderCommand(undefined)).toContain("missing-postgres-cluster-state");
  });

  it("includes explicit fail-closed strings for implemented loader gates", () => {
    const command = postgresClusterLoaderCommand(parsePostgresClusterPreflight(preflight)!);
    for (const gate of [
      "missing-postgres-binary",
      "package-mismatch",
      "missing-data-dir",
      "stale-postmaster-pid",
      "symlink-escape",
      "temp-files",
      "owner-mode-mismatch",
      "config-identity-mismatch",
      "data-dir-identity-mismatch",
      "wal-checkpoint-identity-mismatch",
      "port-in-use",
      "start-failed",
      "not-ready",
      "postmaster-pid-missing",
      "select-one-failed",
    ]) {
      expect(command).toContain(gate);
    }
  });

  it("checks every target preflight before launching postgres", () => {
    const state = parsePostgresClusterPreflight(preflight)!;
    const command = postgresClusterLoaderCommand(state);
    const packageCheck = command.indexOf("package-mismatch");
    const dataDirCheck = command.indexOf("missing-data-dir");
    const identityCheck = command.indexOf("data-dir-identity-mismatch");
    const walCheck = command.indexOf("wal-checkpoint-identity-mismatch");
    const portCheck = command.indexOf("port-in-use");
    const launch = command.indexOf("su -s /bin/sh postgres");
    expect(packageCheck).toBeGreaterThan(0);
    expect(dataDirCheck).toBeGreaterThan(packageCheck);
    expect(identityCheck).toBeGreaterThan(dataDirCheck);
    expect(walCheck).toBeGreaterThan(identityCheck);
    expect(portCheck).toBeGreaterThan(walCheck);
    expect(launch).toBeGreaterThan(portCheck);
  });
});
