import { describe, expect, it } from "vitest";

import type { MoveDescriptor, MoveGenericResourceGraphState } from "../index.ts";

const genericResourceGraphState: MoveGenericResourceGraphState = {
  policy: "generic-resource-graph-target-native-reexec-v1",
  executableIdentity: {
    path: "/usr/local/bin/unknown-daemon",
    realPath: "/usr/local/bin/unknown-daemon",
    packageName: "unknown-daemon-proof",
    version: "1.0.0",
    architecture: "arm64",
    sha256: "9b3f58b40b87cdd2d2fb936b8e8ef7a08d7aa35e39b195d58f89d83f0d6bb5e8",
  },
  argv: ["/usr/local/bin/unknown-daemon", "--root", "/srv/app", "--port", "8123"],
  env: { policy: "captured-explicit", entries: { LANG: "C.UTF-8" } },
  cwd: {
    path: "/srv/app",
    identity: {
      fileCount: 3,
      directoryCount: 2,
      totalBytes: 128,
      treeDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  },
  root: { path: "/" },
  uidGid: { uid: 1000, gid: 1000, groups: [1000], umask: "022" },
  ports: [
    {
      protocol: "tcp",
      port: 8123,
      bindAddress: "127.0.0.1",
      state: "idle-loopback-listener",
      noActiveClients: true,
    },
  ],
  regularFiles: [
    {
      fd: 3,
      path: "/srv/app/config.json",
      access: "read-only",
      flags: ["O_RDONLY"],
      offset: 0,
      identity: {
        size: 42,
        sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    },
  ],
  dataDirs: [
    {
      path: "/srv/app/data",
      access: "write-validated",
      ownerUid: 1000,
      ownerGid: 1000,
      mode: "755",
      identity: {
        fileCount: 2,
        directoryCount: 1,
        totalBytes: 86,
        treeDigest: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      },
    },
  ],
  fileOffsets: [{ fd: 3, offset: 0, policy: "absolute-offset" }],
  stdioPolicy: "stdio-dev-null-or-closed",
  healthProbe: { kind: "http", url: "http://127.0.0.1:8123/health", expectedStatus: 200 },
  resourceClasses: [
    {
      resourceClass: "loopbackTcpListener",
      status: "supported",
      evidence: "listener is loopback-only and has no active clients",
    },
    {
      resourceClass: "regularFileIdentity",
      status: "supported",
      evidence: "fd 3 is regular read-only file with size+sha256 identity",
    },
  ],
  refusalClasses: [],
  capturedAt: "2026-06-11T00:00:00.000Z",
};

describe("MoveGenericResourceGraphState", () => {
  it("is part of the move descriptor capture surface", () => {
    const descriptor: MoveDescriptor = {
      formatVersion: 1,
      kind: "machinen.move.descriptor",
      rootPid: 4242,
      scannedAt: "2026-06-11T00:00:00.000Z",
      nodes: [
        {
          pid: 4242,
          ppid: 1,
          command: "unknown-daemon",
          argv: genericResourceGraphState.argv,
          cwd: "/srv/app",
          exe: "/usr/local/bin/unknown-daemon",
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
        acceptedSubsets: ["generic-resource-graph"],
        capture: { genericResourceGraphState },
      },
    };

    const state = descriptor.resourcePlan?.capture?.genericResourceGraphState;
    expect(state?.policy).toBe("generic-resource-graph-target-native-reexec-v1");
    expect(state?.executableIdentity).toMatchObject({
      path: "/usr/local/bin/unknown-daemon",
      packageName: "unknown-daemon-proof",
    });
    expect(state?.root).toEqual({ path: "/" });
    expect(state?.ports[0]).toMatchObject({
      protocol: "tcp",
      bindAddress: "127.0.0.1",
      noActiveClients: true,
    });
    expect(state?.regularFiles[0]?.identity.sha256).toHaveLength(64);
    expect(state?.dataDirs[0]?.identity.treeDigest).toHaveLength(64);
    expect(state?.fileOffsets[0]).toEqual({ fd: 3, offset: 0, policy: "absolute-offset" });
    expect(state?.stdioPolicy).toBe("stdio-dev-null-or-closed");
    expect(state?.healthProbe).toMatchObject({ kind: "http", expectedStatus: 200 });
    expect(state?.refusalClasses).toEqual([]);
  });

  it("can represent exact refused resource classes", () => {
    const refused: MoveGenericResourceGraphState = {
      ...genericResourceGraphState,
      ports: [],
      resourceClasses: [
        {
          resourceClass: "pipe",
          status: "refused",
          evidence: "fd 4 is pipe:[123] and pipe contents/peer ownership are not modeled",
        },
      ],
      refusalClasses: [
        {
          resourceClass: "pipe",
          status: "refused",
          reason: "pipe fd requires brokered-fd support before generic reexec",
          evidence: "fd=4 path=pipe:[123]",
          nextAction: "graduate pipe broker or keep save refused",
        },
      ],
    };

    expect(refused.refusalClasses[0]).toMatchObject({
      resourceClass: "pipe",
      status: "refused",
    });
  });
});
