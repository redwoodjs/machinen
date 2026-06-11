import { describe, expect, it } from "vitest";

import type { MoveDescriptor, MovePostgresClusterState } from "../index.ts";

const postgresClusterState: MovePostgresClusterState = {
  port: 8159,
  bindAddress: "127.0.0.1",
  dataDir: "/tmp/pgdata-proof",
  packageIdentity: {
    packageName: "postgresql-15",
    version: "15.18-0+deb12u1",
    architecture: "arm64",
    executable: "/usr/lib/postgresql/15/bin/postgres",
  },
  clientPackageIdentity: {
    packageName: "postgresql-client-15",
    version: "15.18-0+deb12u1",
    architecture: "arm64",
  },
  clusterIdentity: {
    pgVersion: "15",
    dataDirOwnerUid: 100,
    dataDirOwnerGid: 102,
    dataDirMode: "700",
    treeEntryCount: 993,
    treeDigest: "c3f122ca9c608075d7526417d12f5ffa5a6d00aa72904f68c5727969ea3f2f99",
    pgControlSha256: "a4acad8d03f61a85a1d5979af1488e423f86b45f60ee14f407c0c3beb02b720a",
    postgresqlConfSha256: "2b23995b2795b3ab778e9d3bb9104f917d93b5702f27ebd8ab5e6694fbccbf3a",
    pgHbaConfSha256: "bc4830d4b3b574118bda071ed29925815a9c3ba188165f7e05bf9ab66b71cc5e",
  },
  walState: {
    policy: "clean-checkpoint-required",
    pgWalDigest: "proof-wal-digest",
    currentWalFiles: ["000000010000000000000001"],
    checkpointEvidence: "pg_control-checkpoint-clean-proof",
  },
  runtimeState: {
    processShape: "postmaster-plus-standard-background-workers",
    activeExternalClients: 0,
    nonIdleUserBackends: 0,
    preparedTransactions: 0,
    replicationSlots: 0,
    nonDefaultTablespaces: 0,
    unloggedRelations: 0,
    tempFiles: 0,
    symlinkEscapes: 0,
    extensionNativeLibraries: 0,
  },
  policy: "postgres-idle-clean-cluster-target-native-restart",
  capturedAt: "2026-06-11T00:00:00.000Z",
};

describe("MovePostgresClusterState", () => {
  it("is part of the move descriptor capture surface", () => {
    const descriptor: MoveDescriptor = {
      formatVersion: 1,
      kind: "machinen.move.descriptor",
      rootPid: 2685,
      scannedAt: "2026-06-11T00:00:00.000Z",
      nodes: [
        {
          pid: 2685,
          ppid: 1,
          command: "postgres",
          argv: ["postgres", "-D", "/tmp/pgdata-proof", "-p", "8159", "-h", "127.0.0.1"],
          cwd: "/tmp/pgdata-proof",
          exe: "/usr/lib/postgresql/15/bin/postgres",
        },
      ],
      edges: [],
      translatedStateClasses: ["process-identity", "argv-env-cwd"],
      refusedStateClasses: [],
      target: "cross-isa-target-native-pid-translation",
      productSurface: "machinen move",
      resourcePlan: {
        kind: "machinen.move.resource-plan",
        source: "guest-procfs",
        resources: [],
        fdTableEntries: [],
        targetGuestResources: [],
        refusals: [],
        acceptedSubsets: ["postgres-idle-clean-cluster"],
        capture: { postgresClusterState },
      },
    };

    expect(descriptor.resourcePlan?.capture?.postgresClusterState?.policy).toBe(
      "postgres-idle-clean-cluster-target-native-restart",
    );
    expect(descriptor.resourcePlan?.capture?.postgresClusterState?.runtimeState).toMatchObject({
      activeExternalClients: 0,
      preparedTransactions: 0,
      replicationSlots: 0,
    });
  });
});
