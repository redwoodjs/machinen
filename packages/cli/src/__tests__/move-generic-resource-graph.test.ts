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
  "FILE_IDENTITY\t3\t/srv/app/config.json\t42\tbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "TCP_FD\t4\t999\t0A\t0100007F:1FBB\t00000000:0000",
].join("\n");

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
          size: 42,
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
    expect(state?.healthProbe).toEqual({ kind: "tcp-connect", host: "127.0.0.1", port: 8123 });
    expect(state?.refusalClasses).toEqual([]);
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
    expect(command.indexOf("fail() {")).toBeLessThan(command.indexOf("unknown-daemon' '--port'"));
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
