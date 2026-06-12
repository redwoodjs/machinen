import type { MoveDescriptor, MovePidGraphNode } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import {
  buildMoveGenericResourceGraphState,
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
}): string {
  return [
    "STATUS\t1000\t1000",
    "ROOT\t/",
    `CWD_IDENTITY\t${options.cwd}\t2\t1\t64\t${shaA}`,
    ...(options.files ?? []).map(
      (file) =>
        `FILE_IDENTITY\t${file.fd}\t${file.path}\t${file.dev ?? 2049}\t${file.inode ?? 9000 + file.fd}\t${file.size}\t${file.mtimeEpochSeconds ?? 1780000000}\t${file.sha256}`,
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
      migrationPreflight({ cwd: directoryNode.cwd!, tcp: [{ fd: 4, inode: "5102", port: 18232 }] }),
    )!;
    expect(directoryState.argv).toContain("--directory");
    expect(directoryState.dataDirs[0]?.path).toBe("/tmp/machinen-generic/static-http/root");
    expect(directoryState.healthProbe).toMatchObject({ kind: "http" });
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
    expect(ncState.refusalClasses).toEqual([]);

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

  it("refuses writable or deleted regular-file cursor shapes before generic load", () => {
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
      expect.arrayContaining(["pipe", "unknown", "pty", "stdio"]),
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
      expect.arrayContaining(["pipe", "pty", "socket", "unknown", "device", "activeTcpConnection"]),
    );
    expect(state?.ports).toEqual([]);
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
});
