import type { MoveDescriptor, MovePidGraphNode } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import { explainGenericResourceGraphMovePlan } from "../move-generic-resource-graph-explain.ts";
import {
  buildMoveGenericResourceGraphState,
  genericResourceGraphIsPrimary,
  genericResourceGraphIsProductPrimary,
  genericResourceGraphLoaderCommand,
  parseGenericResourceGraphPreflight,
} from "../move-generic-resource-graph.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;

const node: MovePidGraphNode = {
  pid: 4242,
  ppid: 1,
  command: "unknown-daemon",
  argv: ["/usr/local/bin/unknown-daemon", "--port", "8123"],
  cwd: "/srv/app",
  exe: "/usr/local/bin/unknown-daemon",
};

const basePlan: MoveResourcePlan = {
  kind: "machinen.move.resource-plan",
  source: "guest-procfs",
  resources: [
    { id: "pid:4242:argv", kind: "argv", state: "captured" },
    { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
    { id: "pid:4242:fd:0", kind: "file", state: "captured", fd: 0, path: "/dev/null" },
    { id: "pid:4242:fd:1", kind: "file", state: "captured", fd: 1, path: "/dev/null" },
    { id: "pid:4242:fd:2", kind: "file", state: "captured", fd: 2, path: "/dev/null" },
    {
      id: "pid:4242:fd:3",
      kind: "file",
      state: "captured",
      fd: 3,
      path: "/srv/app/config.json",
      offset: 0,
      flags: ["octal:0100000"],
    },
    { id: "pid:4242:socket:999", kind: "socket", state: "captured", fd: 4, path: "socket:[999]" },
  ],
  fdTableEntries: [],
  targetGuestResources: [],
  refusals: [],
  acceptedSubsets: [],
  capture: {
    executablePackage: {
      path: "/usr/local/bin/unknown-daemon",
      packageName: "unknown-daemon-proof",
      version: "1.0.0",
      architecture: "arm64",
    },
  },
};

const preflight = [
  "STATUS\t1000\t1000",
  "ROOT\t/",
  "CWD_IDENTITY\t/srv/app\t2\t1\t64\taaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "FILE_IDENTITY\t3\t/srv/app/config.json\t2049\t9001\t42\t1780000000\tbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "TCP_FD\t4\t999\t0A\t0100007F:1FBB\t00000000:0000",
].join("\n");

const shaA = "a".repeat(64);
const shaB = "b".repeat(64);
const shaC = "c".repeat(64);

function migrationPlan(
  candidateNode: MovePidGraphNode,
  resources: MoveResourcePlan["resources"],
): MoveResourcePlan {
  return {
    ...basePlan,
    resources: [
      { id: `pid:${candidateNode.pid}:argv`, kind: "argv", state: "captured" },
      {
        id: `pid:${candidateNode.pid}:cwd`,
        kind: "cwd",
        state: "captured",
        path: candidateNode.cwd,
      },
      {
        id: `pid:${candidateNode.pid}:fd:0`,
        kind: "file",
        state: "captured",
        fd: 0,
        path: "/dev/null",
      },
      {
        id: `pid:${candidateNode.pid}:fd:1`,
        kind: "file",
        state: "captured",
        fd: 1,
        path: "/dev/null",
      },
      {
        id: `pid:${candidateNode.pid}:fd:2`,
        kind: "file",
        state: "captured",
        fd: 2,
        path: "/dev/null",
      },
      ...resources,
    ],
    capture: {
      executablePackage: {
        path: candidateNode.exe ?? candidateNode.argv[0] ?? "/bin/false",
        packageName: "migration-wave-fixture",
        version: "1.0.0",
        architecture: "arm64",
      },
    },
  };
}

function migrationPreflight(options: {
  cwd: string;
  files?: Array<{
    fd: number;
    path: string;
    size: number;
    sha256: string;
    dev?: number;
    inode?: number;
    mtimeEpochSeconds?: number;
  }>;
  tcp?: Array<{ fd: number; inode: string; port: number; state?: string }>;
  dataDirs?: Array<{
    path: string;
    fileCount?: number;
    directoryCount?: number;
    totalBytes?: number;
    sha256?: string;
  }>;
}): string {
  return [
    "STATUS\t1000\t1000",
    "ROOT\t/",
    `CWD_IDENTITY\t${options.cwd}\t2\t1\t64\t${shaA}`,
    ...(options.files ?? []).map(
      (file) =>
        `FILE_IDENTITY\t${file.fd}\t${file.path}\t${file.dev ?? 2049}\t${file.inode ?? 9000 + file.fd}\t${file.size}\t${file.mtimeEpochSeconds ?? 1780000000}\t${file.sha256}`,
    ),
    ...(options.dataDirs ?? []).map(
      (dir) =>
        `DATA_DIR_IDENTITY\t${dir.path}\t${dir.fileCount ?? 1}\t${dir.directoryCount ?? 1}\t${dir.totalBytes ?? 64}\t${dir.sha256 ?? shaA}`,
    ),
    ...(options.tcp ?? []).map(
      (tcp) =>
        `TCP_FD\t${tcp.fd}\t${tcp.inode}\t${tcp.state ?? "0A"}\t0100007F:${tcp.port
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")}\t00000000:0000`,
    ),
  ].join("\n");
}

describe("generic resource graph capture", () => {
  it("parses procfs preflight rows", () => {
    expect(parseGenericResourceGraphPreflight(preflight)).toMatchObject({
      uid: 1000,
      gid: 1000,
      root: "/",
      cwd: {
        fileCount: 2,
        directoryCount: 1,
        totalBytes: 64,
        treeDigest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
      files: [
        {
          fd: 3,
          path: "/srv/app/config.json",
          dev: 2049,
          inode: 9001,
          size: 42,
          mtimeEpochSeconds: 1780000000,
          sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
      tcp: [
        {
          fd: 4,
          inode: "999",
          state: "0A",
          localHost: "127.0.0.1",
          localPort: 8123,
        },
      ],
    });
  });

  it("builds descriptor-only generic state for supported graduated resources", () => {
    const state = buildMoveGenericResourceGraphState(
      node,
      basePlan,
      "/usr/local/bin/unknown-daemon",
      preflight,
    );

    expect(state?.executableIdentity).toMatchObject({
      path: "/usr/local/bin/unknown-daemon",
      packageName: "unknown-daemon-proof",
    });
    expect(state?.ports).toEqual([
      {
        protocol: "tcp",
        port: 8123,
        bindAddress: "127.0.0.1",
        state: "idle-loopback-listener",
        noActiveClients: true,
      },
    ]);
    expect(state?.root).toEqual({ path: "/" });
    expect(state?.regularFiles[0]).toMatchObject({
      fd: 3,
      path: "/srv/app/config.json",
      access: "read-only",
      offset: 0,
    });
    expect(state?.dataDirs[0]?.access).toBe("write-validated");
    expect(state?.dataDirs[0]?.identity.treeDigest).toBe(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(state?.stdioGraph).toEqual({
      policy: "dev-null-or-closed",
      fds: [
        { fd: 0, target: "dev-null", access: "read", evidence: "fd=0 path=/dev/null" },
        { fd: 1, target: "dev-null", access: "write", evidence: "fd=1 path=/dev/null" },
        { fd: 2, target: "dev-null", access: "write", evidence: "fd=2 path=/dev/null" },
      ],
    });
    expect(state?.pipeGraph).toBeUndefined();
    expect(state?.healthProbe).toEqual({ kind: "tcp-connect", host: "127.0.0.1", port: 8123 });
    expect(state?.refusalClasses).toEqual([]);
  });

  it("builds descriptors for wave-1 generic migration candidate shapes", () => {
    const httpNode: MovePidGraphNode = {
      pid: 5101,
      ppid: 1,
      command: "python3",
      argv: ["/usr/bin/python3", "-m", "http.server", "18231"],
      cwd: "/tmp/machinen-generic/static-http/root",
      exe: "/usr/bin/python3",
    };
    const httpState = buildMoveGenericResourceGraphState(
      httpNode,
      migrationPlan(httpNode, [
        {
          id: "pid:5101:fd:4",
          kind: "socket",
          state: "captured",
          fd: 4,
          path: "socket:[5101]",
        },
      ]),
      "/usr/bin/python3",
      migrationPreflight({ cwd: httpNode.cwd!, tcp: [{ fd: 4, inode: "5101", port: 18231 }] }),
    )!;

    expect(httpState).toMatchObject({
      argv: ["/usr/bin/python3", "-m", "http.server", "18231"],
      env: { policy: "target-default" },
      cwd: { path: "/tmp/machinen-generic/static-http/root" },
      root: { path: "/" },
      stdioPolicy: "stdio-dev-null-or-closed",
      healthProbe: { kind: "http", url: "http://127.0.0.1:18231/", expectedStatus: 200 },
      refusalClasses: [],
    });
    expect(httpState.executableIdentity).toMatchObject({
      path: "/usr/bin/python3",
      packageName: "migration-wave-fixture",
    });
    expect(httpState.ports).toEqual([
      {
        protocol: "tcp",
        port: 18231,
        bindAddress: "127.0.0.1",
        state: "idle-loopback-listener",
        noActiveClients: true,
      },
    ]);
    expect(httpState.dataDirs[0]).toMatchObject({
      path: "/tmp/machinen-generic/static-http/root",
      access: "write-validated",
      identity: { treeDigest: shaA },
    });
    expect(httpState.resourceClasses.map((item) => item.resourceClass)).toEqual(
      expect.arrayContaining([
        "processIdentity",
        "argvEnvCwd",
        "directoryIdentity",
        "loopbackTcpListener",
        "healthProbe",
      ]),
    );

    const directoryNode: MovePidGraphNode = {
      ...httpNode,
      pid: 5102,
      argv: ["/usr/bin/python3", "-m", "http.server", "18232", "--directory", httpNode.cwd!],
    };
    const directoryState = buildMoveGenericResourceGraphState(
      directoryNode,
      migrationPlan(directoryNode, [
        {
          id: "pid:5102:fd:4",
          kind: "socket",
          state: "captured",
          fd: 4,
          path: "socket:[5102]",
        },
      ]),
      "/usr/bin/python3",
      migrationPreflight({
        cwd: directoryNode.cwd!,
        tcp: [{ fd: 4, inode: "5102", port: 18232 }],
        dataDirs: [{ path: httpNode.cwd! }],
      }),
    )!;
    expect(directoryState.argv).toContain("--directory");
    expect(directoryState.dataDirs[0]?.path).toBe("/tmp/machinen-generic/static-http/root");
    expect(directoryState.healthProbe).toMatchObject({ kind: "http" });
    expect(directoryState.migration).toMatchObject({
      mode: "generic-primary",
      sourceProofName: "python-http-directory",
      genericProofName: "generic-static-http-daemon",
    });
    expect(directoryState.refusalClasses).toEqual([]);

    const ncNode: MovePidGraphNode = {
      pid: 5103,
      ppid: 1,
      command: "python3",
      argv: [
        "/usr/bin/python3",
        "/tmp/machinen-generic/interpreted-server/bin/tcp_echo.py",
        "18233",
      ],
      cwd: "/tmp/machinen-generic/interpreted-server/root",
      exe: "/usr/bin/python3",
    };
    const ncState = buildMoveGenericResourceGraphState(
      ncNode,
      migrationPlan(ncNode, [
        {
          id: "pid:5103:fd:4",
          kind: "socket",
          state: "captured",
          fd: 4,
          path: "socket:[5103]",
        },
      ]),
      "/usr/bin/python3",
      migrationPreflight({ cwd: ncNode.cwd!, tcp: [{ fd: 4, inode: "5103", port: 18233 }] }),
    )!;
    expect(ncState.healthProbe).toEqual({ kind: "tcp-connect", host: "127.0.0.1", port: 18233 });
    expect(ncState.ports[0]).toMatchObject({ port: 18233, noActiveClients: true });
    expect(ncState.migration).toBeUndefined();
    expect(ncState.refusalClasses).toEqual([]);

    const ncPrimaryNode: MovePidGraphNode = {
      pid: 5107,
      ppid: 1,
      command: "nc",
      argv: ["nc", "-l", "18234"],
      cwd: "/",
      exe: "/usr/bin/nc",
    };
    const ncPrimaryState = buildMoveGenericResourceGraphState(
      ncPrimaryNode,
      migrationPlan(ncPrimaryNode, [
        {
          id: "pid:5107:fd:4",
          kind: "socket",
          state: "captured",
          fd: 4,
          path: "socket:[5107]",
        },
      ]),
      "/usr/bin/nc",
      migrationPreflight({ cwd: "/", tcp: [{ fd: 4, inode: "5107", port: 18234 }] }),
    )!;
    expect(ncPrimaryState.healthProbe).toEqual({ kind: "process-alive" });
    expect(ncPrimaryState.migration).toMatchObject({
      mode: "generic-primary",
      sourceProofName: "nc-listener",
      genericProofName: "generic-interpreted-server",
    });
    expect(ncPrimaryState.refusalClasses).toEqual([]);

    const readerNode: MovePidGraphNode = {
      pid: 5104,
      ppid: 1,
      command: "python3",
      argv: [
        "/usr/bin/python3",
        "/tmp/machinen-generic/file-worker/bin/file_worker.py",
        "/tmp/machinen-generic/file-worker/root/input.txt",
      ],
      cwd: "/tmp/machinen-generic/file-worker/root",
      exe: "/usr/bin/python3",
    };
    const readerState = buildMoveGenericResourceGraphState(
      readerNode,
      migrationPlan(readerNode, [
        {
          id: "pid:5104:fd:3",
          kind: "file",
          state: "captured",
          fd: 3,
          path: "/tmp/machinen-generic/file-worker/root/input.txt",
          offset: 0,
          flags: ["octal:0100000"],
        },
      ]),
      "/usr/bin/python3",
      migrationPreflight({
        cwd: readerNode.cwd!,
        files: [
          {
            fd: 3,
            path: "/tmp/machinen-generic/file-worker/root/input.txt",
            size: 19,
            sha256: shaB,
          },
        ],
      }),
    )!;
    expect(readerState.regularFiles[0]).toMatchObject({
      fd: 3,
      access: "read-only",
      offset: 0,
      cursor: { offset: 0, policy: "read-only-offset" },
      identity: { dev: 2049, inode: 9003, size: 19, mtimeEpochSeconds: 1780000000, sha256: shaB },
    });
    expect(readerState.fileOffsets).toEqual([{ fd: 3, offset: 0, policy: "absolute-offset" }]);
    expect(readerState.healthProbe).toEqual({ kind: "process-alive" });
    expect(readerState.stdioGraph?.policy).toBe("dev-null-or-closed");
    expect(readerState.migration).toBeUndefined();
    expect(readerState.refusalClasses).toEqual([]);

    const grepNode: MovePidGraphNode = {
      ...readerNode,
      pid: 5105,
      argv: [
        "/usr/bin/python3",
        "/tmp/machinen-generic/readonly-cli/bin/readonly_cli.py",
        "/tmp/machinen-generic/readonly-cli/root/input.txt",
      ],
      cwd: "/tmp/machinen-generic/readonly-cli/root",
    };
    const grepState = buildMoveGenericResourceGraphState(
      grepNode,
      migrationPlan(grepNode, [
        {
          id: "pid:5105:fd:3",
          kind: "file",
          state: "captured",
          fd: 3,
          path: "/tmp/machinen-generic/readonly-cli/root/input.txt",
          offset: 0,
          flags: ["octal:0100000"],
        },
      ]),
      "/usr/bin/python3",
      migrationPreflight({
        cwd: grepNode.cwd!,
        files: [
          {
            fd: 3,
            path: "/tmp/machinen-generic/readonly-cli/root/input.txt",
            size: 19,
            sha256: shaC,
          },
        ],
      }),
    )!;
    expect(grepState.regularFiles[0]?.identity.sha256).toBe(shaC);
    expect(grepState.resourceClasses.map((item) => item.resourceClass)).toContain(
      "regularFileIdentity",
    );
    expect(grepState.migration).toBeUndefined();
    expect(grepState.refusalClasses).toEqual([]);

    const tailAdjacentNode: MovePidGraphNode = {
      pid: 5106,
      ppid: 1,
      command: "python3",
      argv: [
        "/usr/bin/python3",
        "/tmp/machinen-generic/writable-log/bin/writable_log.py",
        "/tmp/machinen-generic/writable-log/root/app.log",
      ],
      cwd: "/tmp/machinen-generic/writable-log/root",
      exe: "/usr/bin/python3",
    };
    const tailAdjacentState = buildMoveGenericResourceGraphState(
      tailAdjacentNode,
      migrationPlan(tailAdjacentNode, [
        {
          id: "pid:5106:fd:3",
          kind: "file",
          state: "captured",
          fd: 3,
          path: "/tmp/machinen-generic/writable-log/root/app.log",
          offset: 0,
          flags: ["octal:0100000"],
        },
      ]),
      "/usr/bin/python3",
      migrationPreflight({
        cwd: tailAdjacentNode.cwd!,
        files: [
          {
            fd: 3,
            path: "/tmp/machinen-generic/writable-log/root/app.log",
            size: 18,
            sha256: shaB,
          },
        ],
      }),
    )!;
    expect(tailAdjacentState.dataDirs[0]).toMatchObject({
      path: "/tmp/machinen-generic/writable-log/root",
      access: "write-validated",
    });
    expect(tailAdjacentState.regularFiles[0]?.path).toBe(
      "/tmp/machinen-generic/writable-log/root/app.log",
    );
    expect(tailAdjacentState.refusalClasses).toEqual([]);
  });

  it("classifies append-only, writable, and deleted regular-file cursor shapes", () => {
    const appendState = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          ...basePlan.resources.filter((resource) => resource.fd !== 3),
          {
            id: "pid:4242:fd:3",
            kind: "file",
            state: "captured",
            fd: 3,
            path: "/srv/app/config.json",
            offset: 42,
            flags: ["octal:0102001"],
          },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      preflight,
    );
    expect(appendState?.regularFiles[0]).toMatchObject({
      access: "append-only",
      cursor: { offset: 42, policy: "append-only-end" },
    });
    expect(appendState?.refusalClasses).not.toContainEqual(
      expect.objectContaining({ resourceClass: "appendOnlyRegularFileCursor" }),
    );
    expect(genericResourceGraphLoaderCommand(appendState)).toContain("os.O_WRONLY | os.O_APPEND");

    const appendOffsetMismatchState = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          ...basePlan.resources.filter((resource) => resource.fd !== 3),
          {
            id: "pid:4242:fd:3",
            kind: "file",
            state: "captured",
            fd: 3,
            path: "/srv/app/config.json",
            offset: 41,
            flags: ["octal:0102001"],
          },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      preflight,
    );
    expect(appendOffsetMismatchState?.regularFiles[0]).toMatchObject({
      access: "append-only-refused",
      cursor: { offset: 41, policy: "read-only-offset" },
    });
    expect(appendOffsetMismatchState?.refusalClasses).toContainEqual(
      expect.objectContaining({ resourceClass: "appendOnlyRegularFileCursor" }),
    );

    const appendUnsupportedFlagsState = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          ...basePlan.resources.filter((resource) => resource.fd !== 3),
          {
            id: "pid:4242:fd:3",
            kind: "file",
            state: "captured",
            fd: 3,
            path: "/srv/app/config.json",
            offset: 42,
            flags: ["octal:0103001"],
          },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      preflight,
    );
    expect(appendUnsupportedFlagsState?.regularFiles[0]).toMatchObject({
      access: "append-only-refused",
    });
    expect(appendUnsupportedFlagsState?.refusalClasses).toContainEqual(
      expect.objectContaining({ resourceClass: "appendOnlyRegularFileCursor" }),
    );

    const writableState = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          ...basePlan.resources.filter((resource) => resource.fd !== 3),
          {
            id: "pid:4242:fd:3",
            kind: "file",
            state: "captured",
            fd: 3,
            path: "/srv/app/config.json",
            offset: 7,
            flags: ["octal:0100001"],
          },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      preflight,
    );
    expect(writableState?.regularFiles[0]).toMatchObject({
      access: "read-write-refused",
      cursor: { offset: 7, policy: "read-only-offset" },
    });
    expect(writableState?.refusalClasses).toContainEqual(
      expect.objectContaining({ resourceClass: "writableRegularFileCursor" }),
    );

    const deletedState = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          ...basePlan.resources.filter((resource) => resource.fd !== 3),
          {
            id: "pid:4242:fd:3",
            kind: "file",
            state: "captured",
            fd: 3,
            path: "/srv/app/config.json (deleted)",
            offset: 0,
            flags: ["octal:0100000"],
          },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      preflight,
    );
    expect(deletedState?.refusalClasses).toContainEqual(
      expect.objectContaining({ resourceClass: "regularFileDeleted" }),
    );
  });

  it("emits stale identity preflights and fd cursor reconstruction before success", () => {
    const state = buildMoveGenericResourceGraphState(
      node,
      basePlan,
      "/usr/local/bin/unknown-daemon",
      preflight,
    );
    const command = genericResourceGraphLoaderCommand(state);
    expect(command).not.toContain("fail file-dev-mismatch");
    expect(command).not.toContain("fail file-inode-mismatch");
    expect(command).not.toContain("fail file-mtime-mismatch");
    expect(command).toContain("fail file-identity-mismatch");
    expect(command).toContain("os.lseek(fd, int(item['offset']), os.SEEK_SET)");
    expect(command).toContain("os.dup2(fd, target_fd)");
    expect(command).toContain("os.execvp(spec['argv'][0], spec['argv'])");
    expect(command.indexOf("fail file-identity-mismatch")).toBeLessThan(
      command.indexOf("LOAD_PID"),
    );
    expect(command.indexOf("os.dup2(fd, target_fd)")).toBeLessThan(command.indexOf("LOAD_PID"));
  });

  it("builds descriptor-only stdio and pipe graph evidence while refusing pipe support", () => {
    const pipePlan: MoveResourcePlan = {
      ...basePlan,
      resources: [
        { id: "pid:4242:argv", kind: "argv", state: "captured" },
        { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
        { id: "pid:4242:fd:0", kind: "pipe", state: "captured", fd: 0, path: "pipe:[777]" },
        { id: "pid:4242:fd:1", kind: "pipe", state: "captured", fd: 1, path: "pipe:[777]" },
        { id: "pid:4242:fd:2", kind: "file", state: "captured", fd: 2, path: "/dev/null" },
      ],
    };

    const state = buildMoveGenericResourceGraphState(
      node,
      pipePlan,
      "/usr/local/bin/unknown-daemon",
      preflight,
    );

    expect(state?.stdioPolicy).toBe("refuse-nontrivial-stdio");
    expect(state?.stdioGraph).toMatchObject({
      policy: "modeled-pipe",
      fds: [
        { fd: 0, target: "pipe", access: "read" },
        { fd: 1, target: "pipe", access: "write" },
        { fd: 2, target: "dev-null", access: "write" },
      ],
    });
    expect(state?.pipeGraph?.pipes[0]).toMatchObject({
      inode: "777",
      topology: "one-producer-one-consumer",
      bufferedDataPolicy: "refused-unknown",
      lifecycle: "refused",
    });
    expect(state?.pipeGraph?.pipes[0]?.readFds[0]).toMatchObject({
      fd: 0,
      role: "consumer",
      insideMovedGraph: true,
    });
    expect(state?.pipeGraph?.pipes[0]?.writeFds[0]).toMatchObject({
      fd: 1,
      role: "producer",
      insideMovedGraph: true,
    });
    expect(state?.resourceClasses).toContainEqual(
      expect.objectContaining({ resourceClass: "pipeGraph", status: "supported" }),
    );
    expect(state?.refusalClasses.map((item) => item.resourceClass)).toEqual(
      expect.arrayContaining(["pipe", "stdio"]),
    );
  });

  it("classifies pipe topology and stdio refusal boundaries", () => {
    const topologyPlan: MoveResourcePlan = {
      ...basePlan,
      resources: [
        { id: "pid:4242:argv", kind: "argv", state: "captured" },
        { id: "pid:4242:fd:0", kind: "pipe", state: "captured", fd: 0, path: "pipe:[888]" },
        { id: "pid:4242:fd:1", kind: "pipe", state: "captured", fd: 1, path: "pipe:[888]" },
        { id: "pid:4242:fd:2", kind: "pipe", state: "captured", fd: 2, path: "pipe:[888]" },
        { id: "pid:4242:fd:3", kind: "pipe", state: "captured", fd: 3, path: "pipe:[999]" },
        { id: "pid:4242:fd:4", kind: "unknown", state: "captured", fd: 4, path: "/tmp/named.fifo" },
        {
          id: "pid:4242:fd:5",
          kind: "file",
          state: "captured",
          fd: 5,
          path: "/tmp/stdout.log",
          flags: ["octal:0100000"],
        },
        { id: "pid:4242:fd:6", kind: "pty", state: "captured", fd: 6, path: "/dev/pts/0" },
      ],
    };

    const state = buildMoveGenericResourceGraphState(
      node,
      topologyPlan,
      "/usr/local/bin/unknown-daemon",
      preflight,
    );

    expect(state?.stdioGraph?.policy).toBe("modeled-pipe");
    expect(state?.pipeGraph?.pipes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inode: "888", topology: "fan-in" }),
        expect.objectContaining({ inode: "999", topology: "missing-peer" }),
      ]),
    );
    expect(state?.refusalClasses.map((item) => item.resourceClass)).toEqual(
      expect.arrayContaining(["pipe", "unknown", "terminalOrPtyRefusal", "stdio"]),
    );
    expect(
      state?.refusalClasses.find((item) => item.evidence.includes("named.fifo")),
    ).toMatchObject({ resourceClass: "unknown", status: "refused" });

    const inheritedStdio = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          {
            id: "pid:4242:fd:0",
            kind: "file",
            state: "captured",
            fd: 0,
            path: "/tmp/input.txt",
            flags: ["octal:0100000"],
          },
          { id: "pid:4242:fd:1", kind: "file", state: "captured", fd: 1, path: "/dev/null" },
          { id: "pid:4242:fd:2", kind: "file", state: "captured", fd: 2, path: "/dev/null" },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      preflight,
    );
    expect(inheritedStdio?.stdioGraph?.policy).toBe("inherited-noninteractive");
    expect(inheritedStdio?.refusalClasses.map((item) => item.resourceClass)).toContain("stdio");
  });

  it("records PTY terminal evidence and keeps interactive terminal migration refused", () => {
    const ptyPlan: MoveResourcePlan = {
      ...basePlan,
      resources: [
        { id: "pid:4242:argv", kind: "argv", state: "captured" },
        { id: "pid:4242:fd:0", kind: "pty", state: "captured", fd: 0, path: "/dev/pts/7" },
        { id: "pid:4242:fd:1", kind: "pty", state: "captured", fd: 1, path: "/dev/pts/7" },
        { id: "pid:4242:fd:2", kind: "pty", state: "captured", fd: 2, path: "/dev/pts/7" },
      ],
    };
    const ptyPreflight = [
      "STATUS\t1000\t1000",
      "ROOT\t/",
      "PTY_FD\t0\t/dev/pts/7\t02\t4242\t4242\t4242\t34816\t24\t80\tspeed 38400 baud; rows 24; columns 80; -echo; isig; icanon",
      "PTY_FD\t1\t/dev/pts/7\t02\t4242\t4242\t4242\t34816\t24\t80\tspeed 38400 baud; rows 24; columns 80; -echo; isig; icanon",
      "PTY_FD\t2\t/dev/pts/7\t02\t4242\t4242\t4242\t34816\t24\t80\tspeed 38400 baud; rows 24; columns 80; -echo; isig; icanon",
    ].join("\n");

    const state = buildMoveGenericResourceGraphState(
      node,
      ptyPlan,
      "/usr/local/bin/unknown-daemon",
      ptyPreflight,
    );

    expect(state?.stdioGraph?.policy).toBe("refused");
    expect(state?.stdioGraph?.fds.map((fd) => fd.target)).toEqual(["pty", "pty", "pty"]);
    expect(state?.ptys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fd: 0,
          path: "/dev/pts/7",
          winsize: { rows: 24, columns: 80 },
          termios: expect.stringContaining("-echo"),
          support: "refused-interactive-terminal-boundary",
        }),
      ]),
    );
    expect(state?.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "terminalOrPtyEvidence", status: "supported" }),
        expect.objectContaining({ resourceClass: "terminalOrPtyRefusal", status: "refused" }),
      ]),
    );
    expect(state?.refusalClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resourceClass: "terminalOrPtyRefusal",
          reason: expect.stringContaining("controlling-terminal"),
          evidence: expect.stringContaining("winsize=24x80"),
        }),
        expect.objectContaining({ resourceClass: "stdio" }),
      ]),
    );
  });

  it("supports only proof-marked noninteractive PTY transcript probes", () => {
    const ptyProbeNode = {
      ...node,
      argv: ["/usr/local/bin/pty-probe", "--machinen-pty-transcript-probe"],
      exe: "/usr/local/bin/pty-probe",
    };
    const ptyPlan: MoveResourcePlan = {
      ...basePlan,
      resources: [
        { id: "pid:4242:argv", kind: "argv", state: "captured" },
        { id: "pid:4242:fd:0", kind: "file", state: "captured", fd: 0, path: "/dev/null" },
        { id: "pid:4242:fd:1", kind: "pty", state: "captured", fd: 1, path: "/dev/pts/7" },
        { id: "pid:4242:fd:2", kind: "pty", state: "captured", fd: 2, path: "/dev/pts/7" },
      ],
    };
    const ptyPreflight = [
      "STATUS\t1000\t1000",
      "ROOT\t/",
      "PTY_FD\t1\t/dev/pts/7\t02\t4242\t4242\t4242\t34816\t24\t80\tspeed 38400 baud; rows 24; columns 80; -echo; isig; icanon",
      "PTY_FD\t2\t/dev/pts/7\t02\t4242\t4242\t4242\t34816\t24\t80\tspeed 38400 baud; rows 24; columns 80; -echo; isig; icanon",
    ].join("\n");

    const state = buildMoveGenericResourceGraphState(
      ptyProbeNode,
      ptyPlan,
      "/usr/local/bin/pty-probe",
      ptyPreflight,
    );

    expect(state?.refusalClasses).toEqual([]);
    expect(state?.stdioPolicy).toBe("stdio-inherited-noninteractive");
    expect(state?.stdioGraph?.policy).toBe("modeled-pty-transcript");
    expect(state?.ptys?.[0]).toMatchObject({
      support: "target-native-noninteractive-transcript-probe",
      transcriptProbe: {
        policy: "target-native-reexec-capture-output",
        marker: "--machinen-pty-transcript-probe",
      },
      winsize: { rows: 24, columns: 80 },
      termios: expect.stringContaining("-echo"),
    });
    expect(genericResourceGraphLoaderCommand(state)).toContain("pty.openpty()");
  });

  it("records exact PTY refusal boundaries for dirty editors, alternate screen, job control, foreground pgrp, termios, and winsize", () => {
    const ptyPlan: MoveResourcePlan = {
      ...basePlan,
      resources: [
        { id: "pid:4242:argv", kind: "argv", state: "captured" },
        { id: "pid:4242:fd:0", kind: "pty", state: "captured", fd: 0, path: "/dev/pts/8" },
        { id: "pid:4242:fd:1", kind: "pty", state: "captured", fd: 1, path: "/dev/pts/8" },
        { id: "pid:4242:fd:2", kind: "pty", state: "captured", fd: 2, path: "/dev/pts/8" },
      ],
    };
    const ambiguousPtyPreflight = [
      "STATUS\t1000\t1000",
      "ROOT\t/",
      "PTY_FD\t0\t/dev/pts/8\t02\t4242\t4242\t99\t34816\t\t\tunknown",
    ].join("\n");
    const editorState = buildMoveGenericResourceGraphState(
      {
        ...node,
        command: "vi",
        argv: ["vi", "+normal! Godirty", "/tmp/edit.txt"],
        exe: "/usr/bin/vi",
      },
      ptyPlan,
      "/usr/bin/vi",
      ambiguousPtyPreflight,
    );
    expect(editorState?.refusalClasses.map((item) => item.resourceClass)).toEqual(
      expect.arrayContaining([
        "terminalEditorDirtyState",
        "terminalAlternateScreenState",
        "terminalForegroundProcessGroup",
        "terminalUnknownTermios",
        "terminalWindowSize",
        "terminalOrPtyRefusal",
        "stdio",
      ]),
    );

    const shellState = buildMoveGenericResourceGraphState(
      { ...node, command: "sh", argv: ["sh", "-c", "sleep 60"], exe: "/usr/bin/dash" },
      ptyPlan,
      "/usr/bin/dash",
      ambiguousPtyPreflight,
    );
    expect(shellState?.refusalClasses.map((item) => item.resourceClass)).toEqual(
      expect.arrayContaining(["shellState", "terminalJobControlState"]),
    );
  });

  it("refuses hidden shell state instead of accepting shell pipeline wrappers", () => {
    const shellNode: MovePidGraphNode = {
      ...node,
      command: "sh",
      argv: ["sh", "-c", "printf hi | grep h"],
      exe: "/usr/bin/dash",
    };
    const state = buildMoveGenericResourceGraphState(
      shellNode,
      basePlan,
      "/usr/bin/dash",
      preflight,
    );

    expect(state?.refusalClasses).toContainEqual(
      expect.objectContaining({
        resourceClass: "shellState",
        reason: "shell wrapper state is not a generic pipe/stdio resource graph",
      }),
    );
    expect(state?.resourceClasses).toContainEqual(
      expect.objectContaining({ resourceClass: "shellState", status: "refused" }),
    );
  });

  it("records exact refused resource classes for ungraduated resources", () => {
    const plan: MoveResourcePlan = {
      ...basePlan,
      resources: [
        ...basePlan.resources,
        { id: "pid:4242:fd:5", kind: "pipe", state: "captured", fd: 5, path: "pipe:[123]" },
        { id: "pid:4242:fd:6", kind: "pty", state: "captured", fd: 6, path: "/dev/pts/0" },
        { id: "pid:4242:fd:8", kind: "socket", state: "captured", fd: 8, path: "socket:[2000]" },
        {
          id: "pid:4242:fd:9",
          kind: "unknown",
          state: "captured",
          fd: 9,
          path: "anon_inode:[eventpoll]",
        },
        { id: "pid:4242:fd:10", kind: "file", state: "captured", fd: 10, path: "/dev/kmsg" },
      ],
    };
    const activeTcp = `${preflight}\nTCP_FD\t7\t1000\t01\t0100007F:1FBB\t0100007F:A001`;

    const state = buildMoveGenericResourceGraphState(
      node,
      plan,
      "/usr/local/bin/unknown-daemon",
      activeTcp,
    );

    expect(state?.refusalClasses.map((item) => item.resourceClass)).toEqual(
      expect.arrayContaining([
        "pipe",
        "terminalOrPtyRefusal",
        "socket",
        "epoll",
        "device",
        "activeTcpConnection",
      ]),
    );
    expect(state?.ports).toEqual([]);
  });

  it("supports one exact target-native advisory file lock descriptor", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/usr/bin/python3", "/srv/app/lock_worker.py"], command: "python3" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          {
            id: "pid:4242:fd:3",
            kind: "file",
            state: "captured",
            fd: 3,
            path: "/srv/app/config.json",
            offset: 0,
            flags: ["octal:0100000"],
            recipe: {
              fileLockModel: "advisory-v1",
              fileLockType: "flock",
              fileLockMode: "exclusive",
              fileLockStart: 0,
              fileLockOwnerPid: 4242,
              fileLockFileSize: 42,
              fileLockSha256: shaB,
            },
          },
        ],
      },
      "/usr/bin/python3",
      preflight,
    )!;

    expect(state.refusalClasses).toEqual([]);
    expect(state.fileLocks).toEqual([
      expect.objectContaining({
        fd: 3,
        path: "/srv/app/config.json",
        lockType: "flock",
        mode: "exclusive",
        support: "target-native-advisory-lock",
      }),
    ]);
    expect(state.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "fileLockAdvisory", status: "supported" }),
      ]),
    );
    const command = genericResourceGraphLoaderCommand(state);
    expect(command).toContain("fcntl.flock");
    expect(command).toContain("LOCK_NB");
  });

  it("supports one exact clean file-backed mmap descriptor", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/usr/bin/python3", "/srv/app/mmap_reader.py"], command: "python3" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          {
            id: "pid:4242:fd:3",
            kind: "file",
            state: "captured",
            fd: 3,
            path: "/srv/app/config.json",
            offset: 0,
            flags: ["octal:0100000"],
            recipe: {
              mmapModel: "file-backed-clean-v1",
              mmapPermissions: "r--",
              mmapSharing: "shared",
              mmapOffset: 0,
              mmapLength: 42,
              mmapFileSize: 42,
              mmapSha256: shaB,
            },
          },
        ],
      },
      "/usr/bin/python3",
      preflight,
    )!;

    expect(state.refusalClasses).toEqual([]);
    expect(state.mmapMappings).toEqual([
      expect.objectContaining({
        fd: 3,
        path: "/srv/app/config.json",
        permissions: "r--",
        sharing: "shared",
        dirtyPolicy: "clean-file-backed",
        support: "target-native-file-backed-clean",
      }),
    ]);
    expect(state.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "mmapFileBackedClean", status: "supported" }),
      ]),
    );
    const command = genericResourceGraphLoaderCommand(state);
    expect(command).toContain("mmap.mmap");
    expect(command).toContain("mmap-file-identity-mismatch");
  });

  it("refuses mmap descriptors outside the clean file-backed contract", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/usr/bin/python3", "/srv/app/mmap_reader.py"], command: "python3" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          {
            id: "pid:4242:fd:3",
            kind: "file",
            state: "captured",
            fd: 3,
            path: "/srv/app/config.json",
            offset: 0,
            flags: ["octal:0100000"],
            recipe: {
              mmapModel: "file-backed-clean-v1",
              mmapPermissions: "rw-",
              mmapSharing: "shared",
              mmapOffset: 0,
              mmapLength: 42,
              mmapFileSize: 42,
              mmapSha256: shaB,
            },
          },
        ],
      },
      "/usr/bin/python3",
      preflight,
    )!;

    expect(state.mmapMappings).toEqual([
      expect.objectContaining({ permissions: "rw-", support: "refused-baseline" }),
    ]);
    expect(state.refusalClasses).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceClass: "mmapFile" })]),
    );
    expect(genericResourceGraphLoaderCommand(state)).toContain(
      "PATCH\tgeneric-resource-graph\trefused\tmmapFile",
    );
  });

  it("refuses runtime file-lock and mmap preflight evidence", () => {
    const state = buildMoveGenericResourceGraphState(
      node,
      basePlan,
      "/usr/local/bin/unknown-daemon",
      `${preflight}\nFILE_LOCK\tfd=3 path=/srv/app/config.json blocked-lock-probe\nMMAP_FILE\t7fff0000-7fff1000 rw-s 00000000 00:00 0 /srv/app/config.json`,
    );
    expect(state?.refusalClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "fileLock" }),
        expect.objectContaining({ resourceClass: "mmapFile" }),
      ]),
    );
  });

  it("supports only idle pathname Unix listeners with no active clients", () => {
    const unixPreflight = [
      "STATUS\t1000\t1000",
      "ROOT\t/",
      "UNIX_FD\t-1\t100\t00000002\t00000000\t00010000\t0001\t01\t/tmp/app.sock",
    ].join("\n");
    const socketState = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          { id: "pid:4242:fd:4", kind: "socket", state: "captured", fd: 4, path: "socket:[100]" },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      unixPreflight,
    );
    expect(socketState?.refusalClasses).toEqual([]);
    expect(socketState?.unixSockets).toEqual([
      expect.objectContaining({
        path: "/tmp/app.sock",
        inode: "100",
        state: "idle-pathname-listener",
        noActiveClients: true,
      }),
    ]);
    expect(socketState?.healthProbe).toEqual({ kind: "unix-connect", path: "/tmp/app.sock" });
    expect(socketState?.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "unixSocketPathnameListener" }),
      ]),
    );
  });

  it("classifies Unix socket and anon-inode wave 2 baseline refusals exactly", () => {
    const unixPreflight = [
      "STATUS\t1000\t1000",
      "ROOT\t/",
      "UNIX_FD\t-1\t100\t00000002\t00000000\t00010000\t0001\t01\t/tmp/app.sock",
      "UNIX_FD\t5\t101\t00000002\t00000000\t00010000\t0001\t01\t@abstract-app",
      "UNIX_FD\t6\t102\t00000002\t00000000\t00000000\t0002\t01\t/tmp/app-dgram.sock",
      "UNIX_FD\t7\t103\t00000002\t00000000\t00000000\t0001\t01\t",
      "UNIX_FD\t8\t104\t00000001\t00000000\t00000000\t0001\t03\t",
    ].join("\n");
    expect(parseGenericResourceGraphPreflight(unixPreflight).unix).toHaveLength(5);

    const socketState = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          { id: "pid:4242:fd:4", kind: "socket", state: "captured", fd: 4, path: "socket:[100]" },
          { id: "pid:4242:fd:5", kind: "socket", state: "captured", fd: 5, path: "socket:[101]" },
          { id: "pid:4242:fd:6", kind: "socket", state: "captured", fd: 6, path: "socket:[102]" },
          { id: "pid:4242:fd:7", kind: "socket", state: "captured", fd: 7, path: "socket:[103]" },
          { id: "pid:4242:fd:8", kind: "socket", state: "captured", fd: 8, path: "socket:[104]" },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      unixPreflight,
    );
    expect(socketState?.refusalClasses.map((item) => item.resourceClass)).toEqual(
      expect.arrayContaining([
        "unixSocketPathnameListener",
        "unixSocketAbstract",
        "unixSocketDatagram",
        "unixSocketPair",
        "unixSocketConnected",
      ]),
    );

    const anonState = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          {
            id: "pid:4242:fd:9",
            kind: "eventfd",
            state: "captured",
            fd: 9,
            path: "anon_inode:[eventfd]",
          },
          {
            id: "pid:4242:fd:10",
            kind: "epoll",
            state: "captured",
            fd: 10,
            path: "anon_inode:[eventpoll]",
          },
          {
            id: "pid:4242:fd:11",
            kind: "timer",
            state: "captured",
            fd: 11,
            path: "anon_inode:[timerfd]",
          },
          {
            id: "pid:4242:fd:12",
            kind: "signalfd",
            state: "captured",
            fd: 12,
            path: "anon_inode:[signalfd]",
          },
          {
            id: "pid:4242:fd:13",
            kind: "unknown",
            state: "captured",
            fd: 13,
            path: "anon_inode:[fanotify]",
          },
          {
            id: "pid:4242:fd:14",
            kind: "unknown",
            state: "captured",
            fd: 14,
            path: "anon_inode:[io_uring]",
          },
          {
            id: "pid:4242:fd:15",
            kind: "unknown",
            state: "captured",
            fd: 15,
            path: "anon_inode:[mystery]",
          },
          {
            id: "pid:4242:fd:16",
            kind: "pipe",
            state: "captured",
            fd: 16,
            path: "pipe:[2024]",
          },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      [
        "STATUS\t1000\t1000",
        "ROOT\t/",
        "EVENTFD_FD\t9\t7\t02000002",
        "EPOLL_FD\t10\t02000002",
        "EPOLL_WATCH\t10\t16\tc0000001\t16",
      ].join("\n"),
    );
    expect(anonState?.eventfds).toEqual([
      expect.objectContaining({ fd: 9, counter: "7", path: "anon_inode:[eventfd]" }),
    ]);
    expect(anonState?.epolls).toEqual([
      expect.objectContaining({
        fd: 10,
        path: "anon_inode:[eventpoll]",
        watchedFds: [
          expect.objectContaining({
            targetFd: 16,
            events: "c0000001",
            trigger: "edge",
            oneShot: true,
            watchedResourceClass: "pipe",
          }),
        ],
      }),
    ]);
    expect(anonState?.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "eventfdBaseline", status: "refused" }),
        expect.objectContaining({ resourceClass: "epollBaseline", status: "refused" }),
      ]),
    );
    expect(anonState?.refusalClasses.map((item) => item.resourceClass)).toEqual(
      expect.arrayContaining([
        "eventfd",
        "epoll",
        "timerfd",
        "signalfd",
        "fanotify",
        "ioUring",
        "anonInode",
      ]),
    );
  });

  it("supports only a tiny normal-flag eventfd counter descriptor", () => {
    const eventfdPlan: MoveResourcePlan = {
      ...basePlan,
      resources: [
        { id: "pid:4242:argv", kind: "argv", state: "captured" },
        { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
        {
          id: "pid:4242:fd:3",
          kind: "eventfd",
          state: "captured",
          fd: 3,
          path: "anon_inode:[eventfd]",
          flags: ["octal:02"],
        },
      ],
      capture: { ...basePlan.capture, syscall: "230 0 0 0", wchan: "hrtimer_nanosleep" },
    };
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/bin/sleep", "30"], command: "sleep" },
      eventfdPlan,
      "/bin/sleep",
      ["STATUS\t1000\t1000", "ROOT\t/", "EVENTFD_FD\t3\t7\t02"].join("\n"),
    )!;

    expect(state.refusalClasses).toEqual([]);
    expect(state.eventfds).toEqual([
      expect.objectContaining({ fd: 3, counter: "7", support: "target-native-counter" }),
    ]);
    expect(state.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "eventfdCounter", status: "supported" }),
      ]),
    );
    const command = genericResourceGraphLoaderCommand(state);
    expect(command).toContain("libc.eventfd");
    expect(command).toContain("os.dup2(fd, target_fd");
  });

  it("supports only a tiny epoll set watching the supported eventfd", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/usr/bin/python3", "/srv/app/hold.py"], command: "python3" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          {
            id: "pid:4242:fd:3",
            kind: "eventfd",
            state: "captured",
            fd: 3,
            path: "anon_inode:[eventfd]",
            flags: ["octal:02"],
          },
          {
            id: "pid:4242:fd:4",
            kind: "epoll",
            state: "captured",
            fd: 4,
            path: "anon_inode:[eventpoll]",
            flags: ["octal:02"],
          },
        ],
        capture: { ...basePlan.capture, syscall: "230 0 0 0", wchan: "hrtimer_nanosleep" },
      },
      "/usr/bin/python3",
      [
        "STATUS\t1000\t1000",
        "ROOT\t/",
        "EVENTFD_FD\t3\t7\t02",
        "EPOLL_FD\t4\t02",
        "EPOLL_WATCH\t4\t3\t19\t3",
      ].join("\n"),
    )!;

    expect(state.refusalClasses).toEqual([]);
    expect(state.epolls).toEqual([
      expect.objectContaining({
        fd: 4,
        support: "target-native-eventfd-watch",
        watchedFds: [
          expect.objectContaining({
            targetFd: 3,
            events: "19",
            trigger: "level",
            oneShot: false,
            watchedResourceClass: "eventfd",
          }),
        ],
      }),
    ]);
    expect(state.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "epollEventfdWatch", status: "supported" }),
      ]),
    );
    expect(genericResourceGraphLoaderCommand(state)).toContain("epoll_ctl");
  });

  it("supports one target-native inotify file-follow descriptor without queued replay", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/usr/bin/python3", "/srv/app/follow.py"], command: "python3" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          {
            id: "pid:4242:fd:3",
            kind: "unknown",
            state: "recipe",
            fd: 3,
            path: "anon_inode:[inotify]",
            flags: ["octal:00"],
            recipe: {
              fdinfoFlags: "00",
              inotifyWatches: [
                {
                  wd: 1,
                  path: "/srv/app/app.log",
                  mask: "2",
                  ignoredMask: "0",
                  fileIdentity: {
                    size: 6,
                    sha256: "b1946ac92492d2347c6235b4d2611184c5e4a1b897d1663db90c1405d7c2d89f",
                  },
                },
              ],
            },
          },
        ],
      },
      "/usr/bin/python3",
      ["STATUS\t1000\t1000", "ROOT\t/", "INOTIFY_FD\t3\t00", "INOTIFY_WATCH\t3\t1\t2\t0"].join(
        "\n",
      ),
    )!;

    expect(state.refusalClasses).toEqual([]);
    expect(state.inotifyWatches).toEqual([
      expect.objectContaining({
        fd: 3,
        support: "target-native-file-follow",
        watches: [
          expect.objectContaining({
            path: "/srv/app/app.log",
            mask: "2",
            eventPolicy: "future-events-only-no-queue-replay",
          }),
        ],
      }),
    ]);
    expect(state.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "inotifyFileFollow", status: "supported" }),
      ]),
    );
    const command = genericResourceGraphLoaderCommand(state);
    expect(command).toContain("inotify_add_watch");
    expect(command).toContain("inotify-watch-identity-mismatch");
  });

  it("keeps non-exact inotify masks refused before target launch", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/usr/bin/python3", "/srv/app/follow.py"], command: "python3" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          {
            id: "pid:4242:fd:3",
            kind: "unknown",
            state: "recipe",
            fd: 3,
            path: "anon_inode:[inotify]",
            flags: ["octal:00"],
            recipe: {
              fdinfoFlags: "00",
              inotifyWatches: [
                {
                  wd: 1,
                  path: "/srv/app/app.log",
                  mask: "100",
                  ignoredMask: "0",
                  fileIdentity: {
                    size: 6,
                    sha256: "b1946ac92492d2347c6235b4d2611184c5e4a1b897d1663db90c1405d7c2d89f",
                  },
                },
              ],
            },
          },
        ],
      },
      "/usr/bin/python3",
      ["STATUS\t1000\t1000", "ROOT\t/", "INOTIFY_FD\t3\t00", "INOTIFY_WATCH\t3\t1\t100\t0"].join(
        "\n",
      ),
    )!;

    expect(state.inotifyWatches).toEqual([
      expect.objectContaining({ fd: 3, support: "refused-baseline" }),
    ]);
    expect(state.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "inotifyBaseline", status: "refused" }),
      ]),
    );
    expect(state.refusalClasses).toEqual(
      expect.arrayContaining([expect.objectContaining({ resourceClass: "inotify" })]),
    );
    expect(genericResourceGraphLoaderCommand(state)).toContain(
      "PATCH\tgeneric-resource-graph\trefused\tinotify",
    );
  });

  it("supports one tiny epoll set watching the supported timerfd", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/usr/bin/python3", "/srv/app/timer_epoll.py"], command: "python3" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          {
            id: "pid:4242:fd:3",
            kind: "timer",
            state: "captured",
            fd: 3,
            path: "anon_inode:[timerfd]",
            flags: ["octal:02"],
          },
          {
            id: "pid:4242:fd:4",
            kind: "epoll",
            state: "captured",
            fd: 4,
            path: "anon_inode:[eventpoll]",
            flags: ["octal:02"],
          },
        ],
        capture: { ...basePlan.capture, syscall: "230 0 0 0", wchan: "hrtimer_nanosleep" },
      },
      "/usr/bin/python3",
      [
        "STATUS\t1000\t1000",
        "ROOT\t/",
        "TIMERFD_FD\t3\t02\t1\t0\t0\t3\t0\t0\t0",
        "EPOLL_FD\t4\t02",
        "EPOLL_WATCH\t4\t3\t1\t4",
      ].join("\n"),
    )!;

    expect(state.refusalClasses).toEqual([]);
    expect(state.epolls).toEqual([
      expect.objectContaining({
        fd: 4,
        support: "target-native-timerfd-watch",
        watchedFds: [
          expect.objectContaining({
            targetFd: 3,
            events: "1",
            trigger: "level",
            oneShot: false,
            watchedResourceClass: "timerfd",
          }),
        ],
      }),
    ]);
    expect(state.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "epollTimerfdWatch", status: "supported" }),
      ]),
    );
    const command = genericResourceGraphLoaderCommand(state);
    expect(command).toContain("timerfd_create");
    expect(command).toContain("epoll_ctl");
  });

  it("records signalfd and signal masks while refusing unsafe signal state", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/usr/bin/python3", "/srv/app/signals.py"], command: "python3" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          {
            id: "pid:4242:fd:3",
            kind: "signalfd",
            state: "captured",
            fd: 3,
            path: "anon_inode:[signalfd]",
            flags: ["octal:02"],
          },
        ],
      },
      "/usr/bin/python3",
      [
        "STATUS\t1000\t1000",
        "ROOT\t/",
        "SIGNAL_STATE\t4242\t4242\t0000000000000000\t0000000000000000\t0000000000000200\t0000000000000000\t0000000000000000",
        "SIGNALFD_FD\t3\t02\t0000000000000200",
      ].join("\n"),
    )!;

    expect(state.signalState).toMatchObject({
      sessionId: 4242,
      processGroupId: 4242,
      blockedMaskHex: "0000000000000200",
      dispositionPolicy: "recorded-default-ignored-caught-masks",
      pendingPolicy: "refuse-nonzero-pending",
      support: "refused-baseline",
    });
    expect(state.signalfds).toEqual([
      expect.objectContaining({ fd: 3, sigmask: "0000000000000200", support: "refused-baseline" }),
    ]);
    expect(state.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "signalMaskDispositionEvidence" }),
        expect.objectContaining({ resourceClass: "signalfdBaseline", status: "refused" }),
      ]),
    );
    expect(state.refusalClasses.map((item) => item.resourceClass)).toContain("signalfd");
    expect(genericResourceGraphLoaderCommand(state)).not.toContain("LOAD_PID");
  });

  it("refuses pending signal delivery separately from signalfd fds", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/bin/sleep", "60"], command: "sleep" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/" },
        ],
      },
      "/bin/sleep",
      [
        "STATUS\t1000\t1000",
        "ROOT\t/",
        "SIGNAL_STATE\t4242\t4242\t0000000000000200\t0000000000000000\t0000000000000200\t0000000000000000\t0000000000000000",
      ].join("\n"),
    )!;

    expect(state.signalfds).toEqual([]);
    expect(state.signalState?.pendingMaskHex).toBe("0000000000000200");
    expect(state.refusalClasses.map((item) => item.resourceClass)).toContain("pendingSignalState");
    expect(genericResourceGraphLoaderCommand(state)).not.toContain("LOAD_PID");
  });

  it("supports only a monotonic relative one-shot timerfd descriptor", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, argv: ["/usr/bin/python3", "/srv/app/timer_read.py"], command: "python3" },
      {
        ...basePlan,
        resources: [
          { id: "pid:4242:argv", kind: "argv", state: "captured" },
          { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
          {
            id: "pid:4242:fd:3",
            kind: "timer",
            state: "captured",
            fd: 3,
            path: "anon_inode:[timerfd]",
            flags: ["octal:02"],
          },
        ],
        capture: { ...basePlan.capture, syscall: "230 0 0 0", wchan: "hrtimer_nanosleep" },
      },
      "/usr/bin/python3",
      ["STATUS\t1000\t1000", "ROOT\t/", "TIMERFD_FD\t3\t02\t1\t0\t0\t2\t500000000\t0\t0"].join(
        "\n",
      ),
    )!;

    expect(state.refusalClasses).toEqual([]);
    expect(state.timers).toEqual([
      expect.objectContaining({
        fd: 3,
        clockId: 1,
        valueSeconds: 2,
        valueNanoseconds: 500000000,
        intervalSeconds: 0,
        support: "target-native-relative-oneshot",
        restartPolicy: "monotonic-relative-oneshot-target-native",
      }),
    ]);
    expect(state.resourceClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resourceClass: "timerfdRelativeOneShot", status: "supported" }),
      ]),
    );
    const command = genericResourceGraphLoaderCommand(state);
    expect(command).toContain("timerfd_create");
    expect(command).toContain("timerfd_settime");
  });

  it("refuses unsafe timerfd descriptor variants", () => {
    const make = (row: string, flags = ["octal:02"]) =>
      buildMoveGenericResourceGraphState(
        { ...node, argv: ["/usr/bin/python3", "/srv/app/timer_read.py"], command: "python3" },
        {
          ...basePlan,
          resources: [
            { id: "pid:4242:argv", kind: "argv", state: "captured" },
            { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
            {
              id: "pid:4242:fd:3",
              kind: "timer",
              state: "captured",
              fd: 3,
              path: "anon_inode:[timerfd]",
              flags,
            },
          ],
        },
        "/usr/bin/python3",
        ["STATUS\t1000\t1000", "ROOT\t/", row].join("\n"),
      )!;

    for (const state of [
      make("TIMERFD_FD\t3\t02\t0\t0\t0\t2\t0\t0\t0"),
      make("TIMERFD_FD\t3\t02\t1\t1\t0\t2\t0\t0\t0"),
      make("TIMERFD_FD\t3\t02\t1\t0\t1\t2\t0\t0\t0"),
      make("TIMERFD_FD\t3\t02\t1\t0\t0\t2\t0\t1\t0"),
      make("TIMERFD_FD\t3\t04002\t1\t0\t0\t2\t0\t0\t0", ["octal:04002"]),
    ]) {
      expect(state.refusalClasses.map((item) => item.resourceClass)).toContain("timerfd");
      expect(state.timers?.[0]?.support).toBe("refused-baseline");
      expect(genericResourceGraphLoaderCommand(state)).not.toContain("timerfd_create");
    }
  });

  it("refuses epoll unknown watches, edge/one-shot/nested shapes, active loops, unsupported flags, and incompatible counters", () => {
    const resources: MoveResourcePlan["resources"] = [
      { id: "pid:4242:argv", kind: "argv", state: "captured" },
      { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
      {
        id: "pid:4242:fd:3",
        kind: "eventfd",
        state: "captured",
        fd: 3,
        path: "anon_inode:[eventfd]",
        flags: ["octal:02"],
      },
      {
        id: "pid:4242:fd:4",
        kind: "epoll",
        state: "captured",
        fd: 4,
        path: "anon_inode:[eventpoll]",
        flags: ["octal:02"],
      },
    ];
    const make = (
      watch: string,
      extraResources: MoveResourcePlan["resources"] = [],
      capture = {},
      eventfdLine = "EVENTFD_FD\t3\t7\t02",
      baseResources = resources,
    ) =>
      buildMoveGenericResourceGraphState(
        { ...node, argv: ["/usr/bin/python3", "/srv/app/hold.py"], command: "python3" },
        {
          ...basePlan,
          resources: [...baseResources, ...extraResources],
          capture: { ...basePlan.capture, ...capture },
        },
        "/usr/bin/python3",
        ["STATUS\t1000\t1000", "ROOT\t/", eventfdLine, "EPOLL_FD\t4\t02", watch].join("\n"),
      )!;

    for (const state of [
      make("EPOLL_WATCH\t4\t99\t19\t99"),
      make("EPOLL_WATCH\t4\t3\t80000019\t3"),
      make("EPOLL_WATCH\t4\t3\t40000019\t3"),
      make("EPOLL_WATCH\t4\t5\t19\t5", [
        {
          id: "pid:4242:fd:5",
          kind: "epoll",
          state: "captured",
          fd: 5,
          path: "anon_inode:[eventpoll]",
          flags: ["octal:02"],
        },
      ]),
      make("EPOLL_WATCH\t4\t3\t19\t3", [], { syscall: "232 4 0 1", wchan: "ep_poll" }),
      make("EPOLL_WATCH\t4\t3\t19\t3", [], {}, "EVENTFD_FD\t3\t7\t04002", [
        { ...resources[0]! },
        { ...resources[1]! },
        { ...resources[2]!, flags: ["octal:04002"] },
        { ...resources[3]! },
      ]),
      make("EPOLL_WATCH\t4\t3\t19\t3", [], {}, "EVENTFD_FD\t3\t100000000\t02"),
    ]) {
      expect(state.refusalClasses).toEqual(
        expect.arrayContaining([expect.objectContaining({ resourceClass: "epoll" })]),
      );
    }
  });

  it("refuses eventfd counters with unsupported flags, bad counters, active waiters, or epoll peers", () => {
    const eventfdResource: MoveResourcePlan["resources"][number] = {
      id: "pid:4242:fd:3",
      kind: "eventfd",
      state: "captured",
      fd: 3,
      path: "anon_inode:[eventfd]",
      flags: ["octal:04002"],
    };
    const makeState = (
      resource: MoveResourcePlan["resources"][number],
      stdout: string,
      capture = {},
    ) =>
      buildMoveGenericResourceGraphState(
        { ...node, argv: ["/bin/sleep", "30"], command: "sleep" },
        {
          ...basePlan,
          resources: [
            { id: "pid:4242:argv", kind: "argv", state: "captured" },
            { id: "pid:4242:cwd", kind: "cwd", state: "captured", path: "/srv/app" },
            resource,
          ],
          capture: { ...basePlan.capture, ...capture },
        },
        "/bin/sleep",
        stdout,
      )!;

    expect(
      makeState(eventfdResource, "STATUS\t1000\t1000\nROOT\t/\nEVENTFD_FD\t3\t7\t04002")
        .refusalClasses,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ resourceClass: "eventfd" })]));
    expect(
      makeState(
        { ...eventfdResource, flags: ["octal:02"] },
        "STATUS\t1000\t1000\nROOT\t/\nEVENTFD_FD\t3\tunknown\t02",
      ).refusalClasses,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ resourceClass: "eventfd" })]));
    expect(
      makeState(
        { ...eventfdResource, flags: ["octal:02"] },
        "STATUS\t1000\t1000\nROOT\t/\nEVENTFD_FD\t3\t7\t02",
        { syscall: "63 3 0 8", wchan: "eventfd_read" },
      ).refusalClasses,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ resourceClass: "eventfd" })]));
  });

  it("builds a preflight-first generic loader command", () => {
    const state = buildMoveGenericResourceGraphState(
      node,
      basePlan,
      "/usr/local/bin/unknown-daemon",
      preflight,
    )!;

    const command = genericResourceGraphLoaderCommand(state);

    expect(command).toContain("test -x '/usr/local/bin/unknown-daemon'");
    expect(command).toContain("test -d '/srv/app'");
    expect(command).toContain("stat -c %s '/srv/app/config.json'");
    expect(command).toContain("data-dir-identity-mismatch");
    expect(command).toContain("python3 - '127.0.0.1' '8123'");
    expect(command).toContain("health-tcp-connect-failed");
    expect(command).toContain("os.execvp(spec['argv'][0], spec['argv'])");
    expect(command.indexOf("fail() {")).toBeLessThan(command.indexOf("os.execvp"));
    expect(command.indexOf("health-tcp-connect-failed")).toBeLessThan(command.indexOf("LOAD_PID"));
  });

  it("infers HTTP health probe for Python http.server loopback listeners", () => {
    const state = buildMoveGenericResourceGraphState(
      { ...node, command: "python3", argv: ["python3", "-m", "http.server", "8123"] },
      basePlan,
      "/usr/bin/python3",
      preflight,
    );

    expect(state?.healthProbe).toEqual({
      kind: "http",
      url: "http://127.0.0.1:8123/",
      expectedStatus: 200,
    });
  });

  it("emits HTTP, TCP banner, and command health probes before accepted load", () => {
    const state = buildMoveGenericResourceGraphState(
      node,
      basePlan,
      "/usr/local/bin/unknown-daemon",
      preflight,
    )!;
    const httpCommand = genericResourceGraphLoaderCommand({
      ...state,
      healthProbe: { kind: "http", url: "http://127.0.0.1:8123/health", expectedStatus: 204 },
    });
    const bannerCommand = genericResourceGraphLoaderCommand({
      ...state,
      healthProbe: {
        kind: "tcp-connect",
        host: "127.0.0.1",
        port: 8123,
        expectedBannerSha256: "d".repeat(64),
      },
    });
    const commandProbe = genericResourceGraphLoaderCommand({
      ...state,
      healthProbe: {
        kind: "command",
        argv: ["/usr/bin/test", "-e", "/tmp/ready"],
        expectedStdoutSha256: "e".repeat(64),
      },
    });

    expect(httpCommand).toContain("urllib.request.urlopen");
    expect(httpCommand.indexOf("health-http-failed")).toBeLessThan(httpCommand.indexOf("LOAD_PID"));
    expect(bannerCommand).toContain("health-tcp-banner-failed");
    expect(bannerCommand).toContain("hashlib.sha256");
    expect(commandProbe).toContain("health-command-digest-mismatch");
    expect(commandProbe.indexOf("/usr/bin/test' '-e' '/tmp/ready'")).toBeLessThan(
      commandProbe.indexOf("LOAD_PID"),
    );
  });

  it("emits target-native pipe loader commands for explicit supported pipe lifecycles", () => {
    const state = buildMoveGenericResourceGraphState(
      node,
      basePlan,
      "/usr/local/bin/unknown-daemon",
      preflight,
    )!;
    const finiteCommand = genericResourceGraphLoaderCommand({
      ...state,
      refusalClasses: [],
      stdioGraph: {
        policy: "modeled-pipe",
        fds: [
          { fd: 0, target: "pipe", access: "read", evidence: "stdin pipe" },
          { fd: 1, target: "dev-null", access: "write", evidence: "stdout /dev/null" },
          { fd: 2, target: "dev-null", access: "write", evidence: "stderr /dev/null" },
        ],
      },
      pipeGraph: {
        pipes: [
          {
            inode: "123",
            readFds: [{ pid: 4242, fd: 0, role: "consumer", insideMovedGraph: true, flags: [] }],
            writeFds: [{ pid: 4241, fd: 1, role: "producer", insideMovedGraph: true, flags: [] }],
            topology: "one-producer-one-consumer",
            bufferedDataPolicy: "captured-bytes",
            capturedBytesBase64: "aGVsbG8tcGlwZQo=",
            lifecycle: "finite-replay",
          },
        ],
      },
    });
    const longRunningCommand = genericResourceGraphLoaderCommand({
      ...state,
      refusalClasses: [],
      pipeGraph: {
        pipes: [
          {
            inode: "456",
            readFds: [{ pid: 4242, fd: 0, role: "consumer", insideMovedGraph: true, flags: [] }],
            writeFds: [
              {
                pid: 4241,
                fd: 1,
                role: "producer",
                insideMovedGraph: true,
                flags: [],
                argv: ["/usr/bin/yes", "pipe-line"],
              },
            ],
            topology: "one-producer-one-consumer",
            bufferedDataPolicy: "empty",
            lifecycle: "long-running-pair",
          },
        ],
      },
    });

    expect(finiteCommand).toContain("base64 -d | '/usr/local/bin/unknown-daemon'");
    expect(finiteCommand.indexOf("fail() {")).toBeLessThan(finiteCommand.indexOf("base64 -d |"));
    expect(finiteCommand.indexOf("base64 -d |")).toBeLessThan(finiteCommand.indexOf("LOAD_PID"));
    expect(finiteCommand).toContain('kill -TERM "$pid" $aux_pids');
    expect(longRunningCommand).toContain("test -x '/usr/bin/yes' || fail pipe-producer-missing");
    expect(longRunningCommand).toContain(
      "'/usr/bin/yes' 'pipe-line' 2>\"$log.producer\" | '/usr/local/bin/unknown-daemon'",
    );
    expect(longRunningCommand.indexOf("pipe-producer-missing")).toBeLessThan(
      longRunningCommand.indexOf("'/usr/bin/yes' 'pipe-line'"),
    );
  });

  it("refuses generic loader command before launch when resource refusals remain", () => {
    const state = buildMoveGenericResourceGraphState(
      node,
      {
        ...basePlan,
        resources: [
          ...basePlan.resources,
          { id: "pid:4242:fd:5", kind: "pipe", state: "captured", fd: 5, path: "pipe:[123]" },
        ],
      },
      "/usr/local/bin/unknown-daemon",
      preflight,
    )!;

    const command = genericResourceGraphLoaderCommand(state);

    expect(command).toContain("PATCH\tgeneric-resource-graph\trefused\tpipe");
    expect(command).not.toContain("LOAD_PID");
  });

  it("blocks PHP live-capture generic-primary while stdio, deleted fd, and socket blockers remain", () => {
    const state = genericPrimaryTestState([
      "stdio",
      "regularFileDeleted",
      "socket",
      "writableRegularFileCursor",
    ]);

    expect(genericResourceGraphIsPrimary(state)).toBe(false);
    expect(genericResourceGraphLoaderCommand(state)).toContain(
      "PATCH\tgeneric-resource-graph\trefused\tstdio",
    );
    expect(genericResourceGraphLoaderCommand(state)).not.toContain("LOAD_PID");
  });

  it("keeps former stdio pipe product marker as resource-reconstruction evidence", () => {
    const state = genericPrimaryTestState([]);
    state.migration.productPath = {
      kind: "exact-live-capture",
      markerProofName: "generic-stdio-pipe-product-marker",
      supportProofName: "generic-finite-pipe-buffer-replay",
      refusalProofNames: ["generic-pipe-stdio-refusals"],
      observedGraph: "exact-live-resource-graph",
    };

    expect(genericResourceGraphIsPrimary(state)).toBe(true);
    expect(genericResourceGraphIsProductPrimary(state)).toBe(false);
    expect(explainGenericResourceGraphMovePlan(state)).toMatchObject({
      decision: "resource-reconstruction",
      productSupport: false,
      proofName: "generic-stdio-pipe-product-marker",
    });

    const refused = genericPrimaryTestState(["pipe"]);
    refused.migration.productPath = state.migration.productPath;

    expect(genericResourceGraphIsPrimary(refused)).toBe(false);
    expect(genericResourceGraphIsProductPrimary(refused)).toBe(false);
    expect(explainGenericResourceGraphMovePlan(refused)).toMatchObject({
      decision: "fail-closed-refusal",
      productSupport: false,
      proofName: "generic-stdio-pipe-product-marker",
    });
    expect(genericResourceGraphLoaderCommand(refused)).toContain(
      "PATCH\tgeneric-resource-graph\trefused\tpipe",
    );
    expect(genericResourceGraphLoaderCommand(refused)).not.toContain("LOAD_PID");

    const unpromoted = genericPrimaryTestState([]);
    unpromoted.migration.productPath = {
      kind: "exact-live-capture",
      markerProofName: "redis-live-generic-primary-marker",
      supportProofName: "generic-service-redis-idle-parity",
      refusalProofNames: ["generic-database-data-dir-refusals"],
      observedGraph: "exact-single-process-service",
    };

    expect(genericResourceGraphIsPrimary(unpromoted)).toBe(true);
    expect(genericResourceGraphIsProductPrimary(unpromoted)).toBe(false);
    expect(explainGenericResourceGraphMovePlan(unpromoted)).toMatchObject({
      decision: "blocked",
      productSupport: false,
      proofName: "redis-live-generic-primary-marker",
    });
  });

  it("keeps former wave-2 product markers outside product move continuation", () => {
    for (const productPath of [
      {
        markerProofName: "unix-pathname-listener-live-generic-primary-marker",
        supportProofName: "generic-unix-pathname-listener",
        refusalProofNames: ["generic-unix-pathname-listener-refusals"],
        expectedDecision: "reexec",
      },
      {
        markerProofName: "reader-cat-live-generic-primary-marker",
        supportProofName: "reader-cat",
        refusalProofNames: [
          "generic-stale-file-identity-refusal",
          "generic-deleted-file-fd-refusal",
          "generic-writable-file-cursor-refusal",
        ],
        expectedDecision: "resource-reconstruction",
      },
      {
        markerProofName: "grep-live-generic-primary-marker",
        supportProofName: "grep",
        refusalProofNames: [
          "generic-stale-file-identity-refusal",
          "generic-deleted-file-fd-refusal",
          "generic-writable-file-cursor-refusal",
          "generic-pipe-stdio-refusals",
        ],
        expectedDecision: "resource-reconstruction",
      },
      {
        markerProofName: "busybox-nc-listener-live-generic-primary-marker",
        supportProofName: "busybox-nc-listener",
        refusalProofNames: [
          "unsafe-busybox-nc-refusal",
          "unsafe-nc-active-refusal",
          "generic-loader-preflight-refusals",
        ],
        expectedDecision: "reexec",
      },
      {
        markerProofName: "socat-file-responder-live-generic-primary-marker",
        supportProofName: "socat-file-responder",
        refusalProofNames: [
          "unsafe-socat-file-responder-refusal",
          "generic-loader-preflight-refusals",
        ],
        expectedDecision: "reexec",
      },
    ]) {
      const state = genericPrimaryTestState([]);
      state.migration.productPath = {
        kind: "exact-live-capture",
        observedGraph: "exact-live-resource-graph",
        ...productPath,
      };

      expect(genericResourceGraphIsPrimary(state), productPath.markerProofName).toBe(true);
      expect(genericResourceGraphIsProductPrimary(state), productPath.markerProofName).toBe(false);
      expect(explainGenericResourceGraphMovePlan(state), productPath.markerProofName).toMatchObject(
        {
          decision: productPath.expectedDecision,
          productSupport: false,
          proofName: productPath.markerProofName,
        },
      );

      const refused = genericPrimaryTestState(["activeRequestSession"]);
      refused.migration.productPath = state.migration.productPath;
      expect(genericResourceGraphIsProductPrimary(refused), productPath.markerProofName).toBe(
        false,
      );
      expect(
        explainGenericResourceGraphMovePlan(refused),
        productPath.markerProofName,
      ).toMatchObject({
        decision: "fail-closed-refusal",
        productSupport: false,
        proofName: productPath.markerProofName,
      });
    }
  });

  it("keeps static HTTP tree-identity rows as reexec evidence even with complete tree identity metadata", () => {
    const state = genericPrimaryTestState([]);
    const identity = {
      fileCount: 1,
      directoryCount: 1,
      totalBytes: 386,
      treeDigest: "0".repeat(64),
    };
    state.migration.productPath = {
      kind: "exact-live-capture",
      markerProofName: "node-static-http-live-generic-primary-marker",
      supportProofName: "node-static-http",
      refusalProofNames: [
        "node-active-refusal",
        "node-timer-refusal",
        "node-worker-refusal",
        "native-dlopen-refusal",
        "static-http-tree-identity-refusals",
      ],
      observedGraph: "exact-live-resource-graph",
    };
    state.staticRootTreeIdentity = {
      path: "/tmp/node-static",
      sourceIdentity: identity,
      targetVerification: "generic loader verifies before target launch",
      driftRefusal: "data-dir-identity-mismatch,data-dir-file-count-mismatch",
    };
    state.dataDirs = [{ path: "/tmp/node-static", access: "read-only", identity }];
    state.resourceClasses = [
      {
        resourceClass: "directoryIdentity",
        status: "supported",
        evidence: "unit-test static root digest evidence",
      },
    ];

    expect(genericResourceGraphIsProductPrimary(state)).toBe(false);
    expect(explainGenericResourceGraphMovePlan(state)).toMatchObject({
      decision: "reexec",
      productSupport: false,
      proofName: "node-static-http-live-generic-primary-marker",
    });

    const missingIdentity = { ...state, staticRootTreeIdentity: undefined };
    expect(genericResourceGraphIsProductPrimary(missingIdentity)).toBe(false);
    expect(explainGenericResourceGraphMovePlan(missingIdentity)).toMatchObject({
      decision: "reexec",
      productSupport: false,
    });
  });

  it("explains fallback, proof-only, deferred, and blocked generic rows without product support", () => {
    const fallback = genericPrimaryTestState([]);
    fallback.migration.mode = "generic-equivalent-with-bespoke-fallback";
    fallback.migration.productPath = undefined;

    expect(explainGenericResourceGraphMovePlan(fallback)).toMatchObject({
      decision: "explicit-fallback",
      productSupport: false,
    });

    for (const proofName of [
      "generic-service-process-tree-prefork",
      "generic-same-arch-modeled-continuation",
      "generic-cross-arch-semantic-reconstruction",
    ]) {
      const proofOnly = genericPrimaryTestState([]);
      proofOnly.migration.genericProofName = proofName;
      proofOnly.migration.productPath = undefined;

      expect(genericResourceGraphIsProductPrimary(proofOnly), proofName).toBe(false);
      expect(explainGenericResourceGraphMovePlan(proofOnly), proofName).toMatchObject({
        decision: "proof-only",
        productSupport: false,
        proofName,
      });
      expect(explainGenericResourceGraphMovePlan(proofOnly).userMessage).toContain("proof-only");
    }

    const deferred = genericPrimaryTestState([]);
    deferred.migration.genericProofName = "generic-unix-pathname-client-pair";
    deferred.migration.productPath = undefined;

    expect(explainGenericResourceGraphMovePlan(deferred)).toMatchObject({
      decision: "deferred",
      productSupport: false,
      proofName: "generic-unix-pathname-client-pair",
    });
    expect(explainGenericResourceGraphMovePlan(deferred).userMessage).toContain("deferred");

    for (const proofName of [
      "nginx-live-generic-primary-marker",
      "tail-live-generic-primary-marker",
    ]) {
      const blocked = genericPrimaryTestState([]);
      blocked.migration.genericProofName = proofName;
      blocked.migration.productPath = {
        kind: "exact-live-capture",
        markerProofName: proofName,
        supportProofName: `${proofName}-support`,
        refusalProofNames: [`${proofName}-refusal`],
        observedGraph: "exact-live-resource-graph",
      };

      expect(genericResourceGraphIsProductPrimary(blocked), proofName).toBe(false);
      expect(explainGenericResourceGraphMovePlan(blocked), proofName).toMatchObject({
        decision: "blocked",
        productSupport: false,
        proofName,
      });
      expect(explainGenericResourceGraphMovePlan(blocked).userMessage).toContain("blocked");
    }
  });

  it("does not product-route proof-only, descriptor harness, service, session, or proof-image labels", () => {
    for (const markerProofName of [
      "generic-same-arch-modeled-continuation",
      "generic-cross-arch-semantic-reconstruction",
      "generic-service-process-tree-prefork",
      "generic-service-nginx-static-parity",
      "generic-service-caddy-static-parity",
      "generic-service-ruby-http-parity",
      "generic-service-rsync-daemon-parity",
      "generic-service-redis-idle-parity",
      "generic-database-data-dir-refusals",
      "nginx-live-generic-primary-marker",
      "redis-live-generic-primary-marker",
      "tail-live-generic-primary-marker",
      "move-proof-image-arm64-c7c0c1d96a7a",
    ]) {
      const state = genericPrimaryTestState([]);
      state.migration.genericProofName = markerProofName;
      state.migration.productPath = {
        kind: "exact-live-capture",
        markerProofName,
        supportProofName: markerProofName,
        refusalProofNames: [`${markerProofName}-refusals`],
        observedGraph: "exact-live-resource-graph",
      };

      expect(genericResourceGraphIsPrimary(state), markerProofName).toBe(true);
      expect(genericResourceGraphIsProductPrimary(state), markerProofName).toBe(false);
      expect(explainGenericResourceGraphMovePlan(state), markerProofName).toMatchObject({
        productSupport: false,
      });
    }
  });

  it("blocks process-tree generic-primary refusal classes before target launch", () => {
    for (const resourceClass of [
      "serviceManagedChildWorkers",
      "dynamicWorkerPool",
      "activeRequestSession",
      "serviceReloadRace",
      "nonExactProcessTree",
    ]) {
      const state = genericPrimaryTestState([resourceClass]);

      expect(genericResourceGraphIsPrimary(state)).toBe(false);
      expect(genericResourceGraphLoaderCommand(state)).toContain(
        `PATCH\tgeneric-resource-graph\trefused\t${resourceClass}`,
      );
      expect(genericResourceGraphLoaderCommand(state)).not.toContain("LOAD_PID");
    }
  });
});

function genericPrimaryTestState(refusalClasses: string[]) {
  return {
    policy: "generic-resource-graph-target-native-reexec-v1",
    migration: {
      mode: "generic-primary",
      sourceProofName: "unit-service",
      genericProofName: "unit-generic-service",
      fallbackPolicy: "explicit fallback remains available outside this exact unit-test shape",
      boundary: "unit test blocker boundary",
    },
    executableIdentity: { path: "/usr/bin/unit-service" },
    argv: ["/usr/bin/unit-service"],
    env: { policy: "target-default" },
    cwd: { path: "/" },
    ports: [],
    regularFiles: [],
    dataDirs: [],
    fileOffsets: [],
    stdioPolicy: "stdio-dev-null-or-closed",
    healthProbe: { kind: "process-alive" },
    resourceClasses: [],
    refusalClasses: refusalClasses.map((resourceClass) => ({
      resourceClass,
      status: "refused",
      reason: `${resourceClass} remains live-capture blocker evidence`,
      evidence: "focused unit-test blocker evidence",
      nextAction: "keep generic-primary refused until modeled",
    })),
  } as Parameters<typeof genericResourceGraphIsPrimary>[0];
}
