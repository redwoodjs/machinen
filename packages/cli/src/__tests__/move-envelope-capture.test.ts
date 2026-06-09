import type { MoveDescriptor, MovePidGraphNode, VmHandle } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import {
  readMoveBusyboxHttpState,
  readMoveCpState,
  readMoveDdState,
  readMoveEnvStateInVm,
  readMoveFindStateInVm,
  readMoveGoStaticHttpState,
  readMoveHttpState,
  readMoveMvStateInVm,
  readMoveNcState,
  readMoveNodeStaticHttpStateInVm,
  readMovePythonStaticRouteStateInVm,
  readMoveReaderStateInVm,
  readMoveRustStaticHttpState,
  readMoveSha256StateInVm,
  readMoveSortStateInVm,
  readMoveWcStateInVm,
  readMoveTailGrepPipelineState,
  readMoveTarState,
  readMoveTimeoutState,
} from "../move-envelope-capture.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;

const baseResourcePlan: MoveResourcePlan = {
  kind: "machinen.move.resource-plan",
  source: "guest-procfs",
  resources: [],
  fdTableEntries: [],
  targetGuestResources: [],
  refusals: [],
  acceptedSubsets: [],
};

describe("move envelope capture helpers", () => {
  it("captures cat reader offset from the input file fd", async () => {
    const state = await readMoveReaderStateInVm(mockVm(), catNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/out", offset: 12 },
        { id: "input", fd: 6, kind: "file", state: "recipe", path: "/tmp/cat.txt", offset: 128 },
      ],
    });

    expect(state).toMatchObject({
      command: "cat",
      path: "/tmp/cat.txt",
      offset: 128,
      outputPath: "/tmp/out",
    });
  });

  it("captures go static http marker argv state", () => {
    expect(readMoveGoStaticHttpState(goStaticNode(), httpResourcePlan(1))).toMatchObject({
      binaryPath: "/tmp/go-static/server",
      cwd: "/tmp/go-static",
      markerVersion: "go-static-http-v1",
      port: 8145,
      healthPath: "/health",
    });
  });

  it("omits go static http state when extra sockets indicate goroutine or client activity", () => {
    expect(readMoveGoStaticHttpState(goStaticNode(), httpResourcePlan(2))).toBeUndefined();
  });

  it("captures rust static http marker argv state", () => {
    expect(readMoveRustStaticHttpState(rustStaticNode(), httpResourcePlan(1))).toMatchObject({
      binaryPath: "/tmp/rust-static/server",
      cwd: "/tmp/rust-static",
      markerVersion: "rust-static-http-v1",
      port: 8148,
      healthPath: "/health",
    });
  });

  it("omits python static route state without marker contract", async () => {
    await expect(
      readMovePythonStaticRouteStateInVm(
        mockVm('PORT = 8143\nROUTE = "/health"\nRESPONSE = "python-static-ok"\n'),
        pythonStaticRouteNode(),
        httpResourcePlan(1),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures marker-labeled python static route harness", async () => {
    const state = await readMovePythonStaticRouteStateInVm(
      mockVm(
        '# machinen-move-envelope: python-static-route-v1\nPORT = 8143\nROUTE = "/health"\nRESPONSE = "python-static-ok"\n',
      ),
      pythonStaticRouteNode(),
      httpResourcePlan(1),
    );

    expect(state).toMatchObject({
      executable: "python3",
      scriptPath: "/tmp/python-static/server.py",
      cwd: "/tmp/python-static",
      port: 8143,
      route: "/health",
      expectedBody: "python-static-ok",
    });
  });

  it("omits node static argv state when extra sockets indicate active clients", async () => {
    await expect(
      readMoveNodeStaticHttpStateInVm(
        mockVm(`// machinen-move-envelope: static-http-argv-v1\nif (req.url === "/health") {}\n`),
        nodeStaticArgvNode(),
        httpResourcePlan(2),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures marked node static http argv contract state", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(`// machinen-move-envelope: static-http-argv-v1\nif (req.url === "/health") {}\n`),
      nodeStaticArgvNode(),
      httpResourcePlan(1),
    );

    expect(state).toMatchObject({
      scriptPath: "/tmp/node-argv-static/server.mjs",
      cwd: "/tmp/node-argv-static",
      port: 8140,
      rootDir: "/tmp/node-argv-static/public",
      argvContract: "--port-root-static-http-v1",
      healthPath: "/health",
    });
  });

  it("captures narrow marked node static http server", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(
        '/* machinen-move-envelope: static-http-v1 */\nconst PORT = 8130;\nif (req.url === "/health") {}\n',
      ),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toMatchObject({
      scriptPath: "/tmp/node-static/server.mjs",
      cwd: "/tmp/node-static",
      port: 8130,
      healthPath: "/health",
    });
  });

  it("omits marked node static http state when timers are used", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(
        '/* machinen-move-envelope: static-http-v1 */\nconst PORT = 8130;\nsetInterval(() => {}, 1000);\nif (req.url === "/health") {}\n',
      ),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toBeUndefined();
  });

  it("omits marked node static http state when worker threads are used", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(
        '/* machinen-move-envelope: static-http-v1 */\nimport { Worker } from "node:worker_threads";\nconst PORT = 8130;\nif (req.url === "/health") {}\n',
      ),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toBeUndefined();
  });

  it("omits marked node static http state when native addon dlopen shapes are present", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm(
        '/* machinen-move-envelope: static-http-v1 */\nconst PORT = 8130;\nfunction loadNative() { process.dlopen(process, "./native-addon.node"); }\nif (req.url === "/health") {}\n',
      ),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toBeUndefined();
  });

  it("omits node static http state without the marker", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm("const PORT = 8130;\n"),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toBeUndefined();
  });

  it("omits timeout state for signal customization", () => {
    expect(
      readMoveTimeoutState(
        { ...timeoutNode(), argv: ["timeout", "-s", "KILL", "30", ...timeoutChildNode().argv] },
        [timeoutNode(), timeoutChildNode()],
        httpResourcePlan(1),
      ),
    ).toBeUndefined();
  });

  it("captures timeout around supported python http child", () => {
    expect(
      readMoveTimeoutState(timeoutNode(), [timeoutNode(), timeoutChildNode()], httpResourcePlan(1)),
    ).toMatchObject({
      seconds: 30,
      child: "python-http-server",
      httpState: {
        port: 8138,
        directory: "/tmp/timeout-web",
      },
    });
  });

  it("omits env proof variable for unsupported child shapes", async () => {
    await expect(
      readMoveEnvStateInVm(
        mockVm("wrapped-http\n"),
        { ...httpDirectoryNode(), argv: ["python3", "-c", "import time; time.sleep(20)"] },
        httpResourcePlan(0),
      ),
    ).resolves.toBeUndefined();
  });

  it("captures explicit env proof variable for supported python http child", async () => {
    await expect(
      readMoveEnvStateInVm(mockVm("wrapped-http\n"), httpDirectoryNode(), httpResourcePlan(1)),
    ).resolves.toMatchObject({
      key: "MACHINEN_MOVE_ENV_PROOF",
      value: "wrapped-http",
      child: "python-http-server",
    });
  });

  it("captures idle python http server only with one listener socket", () => {
    expect(readMoveHttpState(httpNode(), httpResourcePlan(1))).toMatchObject({
      executable: "python3",
      port: 8123,
      cwd: "/tmp/web",
    });
  });

  it("captures idle nc listener with explicit port", () => {
    expect(readMoveNcState(ncNode(), httpResourcePlan(1))).toMatchObject({
      port: 8135,
    });
  });

  it("omits nc listener state when an active client adds socket state", () => {
    expect(readMoveNcState(ncNode(), httpResourcePlan(2))).toBeUndefined();
  });

  it("captures busybox httpd with explicit port and root", () => {
    expect(readMoveBusyboxHttpState(busyboxHttpNode(), httpResourcePlan(1))).toMatchObject({
      port: 8134,
      root: "/tmp/busybox-web",
    });
  });

  it("captures python http server with explicit directory", () => {
    expect(readMoveHttpState(httpDirectoryNode(), httpResourcePlan(1))).toMatchObject({
      executable: "python3",
      port: 8128,
      cwd: "/",
      directory: "/tmp/web-directory",
    });
  });

  it("omits python http state for cgi or unknown listener shapes", () => {
    expect(
      readMoveHttpState(
        { ...httpNode(), argv: ["python3", "-m", "http.server", "--cgi", "8129"] },
        httpResourcePlan(1),
      ),
    ).toBeUndefined();
  });

  it("omits python http state when extra sockets indicate active or unsafe connections", () => {
    expect(readMoveHttpState(httpNode(), httpResourcePlan(2))).toBeUndefined();
  });

  it("captures tar archive and source directory for the narrow create shape", () => {
    const state = readMoveTarState(tarNode());

    expect(state).toMatchObject({
      archivePath: "/tmp/archive.tar",
      sourceDir: "/tmp/tar-tree",
    });
  });

  it("omits tar state when the archive is inside the source directory", () => {
    expect(
      readMoveTarState({
        ...tarNode(),
        argv: ["tar", "-cf", "/tmp/tar-tree/archive.tar", "/tmp/tar-tree"],
      }),
    ).toBeUndefined();
  });

  it("captures find root and last emitted path for the narrow supported shape", async () => {
    const state = await readMoveFindStateInVm(mockVm("/tmp/tree/file-010\n"), findNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/find.out", offset: 190 },
      ],
    });

    expect(state).toMatchObject({
      rootPath: "/tmp/tree",
      outputPath: "/tmp/find.out",
      lastPath: "/tmp/tree/file-010",
    });
  });

  it("omits find state for complex predicates outside the narrow envelope", async () => {
    const state = await readMoveFindStateInVm(mockVm("/tmp/tree/file-010\n"), complexFindNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/find.out", offset: 190 },
      ],
    });

    expect(state).toBeUndefined();
  });

  it("omits sha256sum state without exactly one explicit file path", async () => {
    await expect(
      readMoveSha256StateInVm(
        mockVm(""),
        { ...sha256Node(), argv: ["sha256sum"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
    await expect(
      readMoveSha256StateInVm(
        mockVm(""),
        { ...sha256Node(), argv: ["sha256sum", "/tmp/sha256.in", "/tmp/sha256.extra"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures sha256sum file shape", async () => {
    const state = await readMoveSha256StateInVm(
      mockVm("ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2\n"),
      sha256Node(),
      {
        ...baseResourcePlan,
        resources: [
          {
            id: "stdout",
            fd: 1,
            kind: "file",
            state: "recipe",
            path: "/tmp/sha256.out",
            offset: 0,
          },
        ],
      },
    );

    expect(state).toMatchObject({
      path: "/tmp/sha256.in",
      expectedDigest: "ffd6cd2894e292d4fb55b643a8e3e3710a28a63ae4210495948211423bd71dc2",
      outputPath: "/tmp/sha256.out",
    });
  });

  it("omits wc state without an explicit file path", async () => {
    await expect(
      readMoveWcStateInVm(mockVm(""), { ...wcNode(), argv: ["wc", "-l"] }, baseResourcePlan),
    ).resolves.toBeUndefined();
  });

  it("captures wc line-count file shape", async () => {
    const state = await readMoveWcStateInVm(mockVm(""), wcNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/wc.out", offset: 0 },
      ],
    });

    expect(state).toMatchObject({
      path: "/tmp/wc.in",
      mode: "lines",
      outputPath: "/tmp/wc.out",
    });
  });

  it("omits sort state for output-same-as-input mutation shape", async () => {
    await expect(
      readMoveSortStateInVm(
        mockVm(""),
        { ...sortNode(), argv: ["sort", "-o", "/tmp/sort.in", "/tmp/sort.in"] },
        baseResourcePlan,
      ),
    ).resolves.toBeUndefined();
  });

  it("captures sort input and output path for the narrow deterministic file shape", async () => {
    const state = await readMoveSortStateInVm(mockVm(""), sortNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "stdout", fd: 1, kind: "file", state: "recipe", path: "/tmp/sort.out", offset: 0 },
      ],
    });

    expect(state).toMatchObject({
      path: "/tmp/sort.in",
      outputPath: "/tmp/sort.out",
    });
  });

  it("captures mv source and destination for the narrow same-fs preflight shape", async () => {
    const state = await readMoveMvStateInVm(mockVm(""), mvNode());

    expect(state).toMatchObject({
      sourcePath: "/tmp/mv.in",
      destinationPath: "/tmp/mv.out",
    });
  });

  it("omits mv state when filesystem preflight fails", async () => {
    await expect(readMoveMvStateInVm(mockVm("", 1), mvNode())).resolves.toBeUndefined();
  });

  it("omits cp state for recursive copies outside the narrow envelope", () => {
    expect(
      readMoveCpState(
        { ...cpNode(), argv: ["cp", "-r", "/tmp/cp-dir", "/tmp/cp-out"] },
        baseResourcePlan,
      ),
    ).toBeUndefined();
  });

  it("captures cp source and destination offsets for the narrow supported shape", () => {
    const state = readMoveCpState(cpNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "src", fd: 4, kind: "file", state: "recipe", path: "/tmp/cp.in", offset: 8192 },
        { id: "dst", fd: 5, kind: "file", state: "recipe", path: "/tmp/cp.out", offset: 4096 },
      ],
    });

    expect(state).toMatchObject({
      sourcePath: "/tmp/cp.in",
      destinationPath: "/tmp/cp.out",
      sourceOffset: 8192,
      destinationOffset: 4096,
    });
  });

  it("captures dd read and write offsets for the narrow supported shape", () => {
    const state = readMoveDdState(ddNode(), {
      ...baseResourcePlan,
      resources: [
        { id: "input", fd: 6, kind: "file", state: "recipe", path: "/tmp/dd.in", offset: 4096 },
        { id: "output", fd: 7, kind: "file", state: "recipe", path: "/tmp/dd.out", offset: 4096 },
      ],
    });

    expect(state).toMatchObject({
      inputPath: "/tmp/dd.in",
      outputPath: "/tmp/dd.out",
      blockSize: 1,
      inputOffset: 4096,
      outputOffset: 4096,
    });
  });

  it("captures the supported tail grep pipeline state", () => {
    const state = readMoveTailGrepPipelineState([shNode(), tailNode(), grepNode()], {
      ...baseResourcePlan,
      resources: [
        {
          id: "tail-file",
          fd: 6,
          kind: "file",
          state: "recipe",
          path: "/tmp/pipeline.txt",
          offset: 35,
        },
      ],
    });

    expect(state).toMatchObject({
      tailPath: "/tmp/pipeline.txt",
      offset: 35,
      pattern: "match",
      lineBuffered: true,
    });
  });

  it("refuses unsupported pipe graph shapes by omitting pipeline state", () => {
    const state = readMoveTailGrepPipelineState(
      [shNode(), tailNode(), grepNode(), extraGrepNode()],
      {
        ...baseResourcePlan,
        resources: [
          {
            id: "tail-file",
            fd: 6,
            kind: "file",
            state: "recipe",
            path: "/tmp/pipeline.txt",
            offset: 35,
          },
        ],
      },
    );

    expect(state).toBeUndefined();
  });
});

function mockVm(stdout = "12\n", exitCode = 0): VmHandle {
  return {
    execRaw: async () => ({ exitCode, stdout, stderr: "" }),
  } as unknown as VmHandle;
}

function goStaticNode(): MovePidGraphNode {
  return {
    pid: 33,
    ppid: 1,
    command: "server",
    argv: [
      "/tmp/go-static/server",
      "--machinen-move-envelope",
      "go-static-http-v1",
      "--port",
      "8145",
      "--health",
      "/health",
    ],
    cwd: "/tmp/go-static",
    exe: "/tmp/go-static/server",
  };
}

function rustStaticNode(): MovePidGraphNode {
  return {
    pid: 34,
    ppid: 1,
    command: "server",
    argv: [
      "/tmp/rust-static/server",
      "--machinen-move-envelope",
      "rust-static-http-v1",
      "--port",
      "8148",
      "--health",
      "/health",
    ],
    cwd: "/tmp/rust-static",
    exe: "/tmp/rust-static/server",
  };
}

function pythonStaticRouteNode(): MovePidGraphNode {
  return {
    pid: 32,
    ppid: 1,
    command: "python3",
    argv: ["python3", "/tmp/python-static/server.py"],
    cwd: "/tmp/python-static",
    exe: "/usr/bin/python3",
  };
}

function nodeStaticArgvNode(): MovePidGraphNode {
  return {
    pid: 31,
    ppid: 1,
    command: "node",
    argv: [
      "node",
      "/tmp/node-argv-static/server.mjs",
      "--port",
      "8140",
      "--root",
      "/tmp/node-argv-static/public",
    ],
    cwd: "/tmp/node-argv-static",
    exe: "/usr/bin/node",
  };
}

function nodeStaticNode(): MovePidGraphNode {
  return {
    pid: 20,
    ppid: 1,
    command: "node",
    argv: ["node", "/tmp/node-static/server.mjs"],
    cwd: "/tmp/node-static",
    exe: "/usr/bin/node",
  };
}

function httpResourcePlan(socketCount: number): MoveResourcePlan {
  return {
    ...baseResourcePlan,
    resources: Array.from({ length: socketCount }, (_, index) => ({
      id: `socket-${index}`,
      fd: 4 + index,
      kind: "socket" as const,
      state: "captured" as const,
      path: `socket:[${index}]`,
    })),
  };
}

function timeoutNode(): MovePidGraphNode {
  return {
    pid: 29,
    ppid: 1,
    command: "timeout",
    argv: [
      "timeout",
      "30",
      "python3",
      "-m",
      "http.server",
      "--directory",
      "/tmp/timeout-web",
      "8138",
      "--bind",
      "127.0.0.1",
    ],
    cwd: "/",
    exe: "/usr/bin/timeout",
  };
}

function timeoutChildNode(): MovePidGraphNode {
  return {
    pid: 30,
    ppid: 29,
    command: "python3",
    argv: [
      "python3",
      "-m",
      "http.server",
      "--directory",
      "/tmp/timeout-web",
      "8138",
      "--bind",
      "127.0.0.1",
    ],
    cwd: "/",
    exe: "/usr/bin/python3",
  };
}

function ncNode(): MovePidGraphNode {
  return {
    pid: 28,
    ppid: 1,
    command: "nc",
    argv: ["nc", "-l", "8135"],
    cwd: "/",
    exe: "/usr/bin/nc.openbsd",
  };
}

function busyboxHttpNode(): MovePidGraphNode {
  return {
    pid: 27,
    ppid: 1,
    command: "busybox",
    argv: ["busybox", "httpd", "-f", "-p", "8134", "-h", "/tmp/busybox-web"],
    cwd: "/",
    exe: "/usr/bin/busybox",
  };
}

function httpDirectoryNode(): MovePidGraphNode {
  return {
    pid: 26,
    ppid: 1,
    command: "python3",
    argv: ["python3", "-m", "http.server", "--directory", "/tmp/web-directory", "8128"],
    cwd: "/",
    exe: "/usr/bin/python3",
  };
}

function httpNode(): MovePidGraphNode {
  return {
    pid: 19,
    ppid: 1,
    command: "python3",
    argv: ["python3", "-m", "http.server", "8123", "--bind", "127.0.0.1"],
    cwd: "/tmp/web",
    exe: "/usr/bin/python3",
  };
}

function sha256Node(): MovePidGraphNode {
  return {
    pid: 25,
    ppid: 1,
    command: "sha256sum",
    argv: ["sha256sum", "/tmp/sha256.in"],
    cwd: "/",
    exe: "/usr/bin/sha256sum",
  };
}

function wcNode(): MovePidGraphNode {
  return {
    pid: 24,
    ppid: 1,
    command: "wc",
    argv: ["wc", "-l", "/tmp/wc.in"],
    cwd: "/",
    exe: "/usr/bin/wc",
  };
}

function sortNode(): MovePidGraphNode {
  return {
    pid: 23,
    ppid: 1,
    command: "sort",
    argv: ["sort", "/tmp/sort.in"],
    cwd: "/",
    exe: "/usr/bin/sort",
  };
}

function mvNode(): MovePidGraphNode {
  return {
    pid: 22,
    ppid: 1,
    command: "mv",
    argv: ["mv", "/tmp/mv.in", "/tmp/mv.out"],
    cwd: "/",
    exe: "/usr/bin/mv",
  };
}

function cpNode(): MovePidGraphNode {
  return {
    pid: 21,
    ppid: 1,
    command: "cp",
    argv: ["cp", "/tmp/cp.in", "/tmp/cp.out"],
    cwd: "/",
    exe: "/usr/bin/cp",
  };
}

function tarNode(): MovePidGraphNode {
  return {
    pid: 18,
    ppid: 1,
    command: "tar",
    argv: ["tar", "-cf", "/tmp/archive.tar", "/tmp/tar-tree"],
    cwd: "/",
    exe: "/usr/bin/tar",
  };
}

function findNode(): MovePidGraphNode {
  return {
    pid: 16,
    ppid: 1,
    command: "find",
    argv: ["find", "/tmp/tree", "-type", "f", "-print"],
    cwd: "/",
    exe: "/usr/bin/find",
  };
}

function complexFindNode(): MovePidGraphNode {
  return {
    ...findNode(),
    argv: ["find", "/tmp/tree", "-type", "f", "-name", "*.txt", "-print"],
  };
}

function shNode(): MovePidGraphNode {
  return {
    pid: 10,
    ppid: 1,
    command: "sh",
    argv: ["sh", "-c", "tail -f /tmp/pipeline.txt | grep --line-buffered match"],
    cwd: "/",
    exe: "/usr/bin/dash",
  };
}

function catNode(): MovePidGraphNode {
  return {
    pid: 11,
    ppid: 1,
    command: "cat",
    argv: ["cat", "/tmp/cat.txt"],
    cwd: "/",
    exe: "/usr/bin/cat",
  };
}

function ddNode(): MovePidGraphNode {
  return {
    pid: 15,
    ppid: 1,
    command: "dd",
    argv: ["dd", "if=/tmp/dd.in", "of=/tmp/dd.out", "bs=1"],
    cwd: "/",
    exe: "/usr/bin/dd",
  };
}

function tailNode(): MovePidGraphNode {
  return {
    pid: 12,
    ppid: 10,
    command: "tail",
    argv: ["tail", "-n", "+1", "-f", "/tmp/pipeline.txt"],
    cwd: "/",
    exe: "/usr/bin/tail",
  };
}

function grepNode(): MovePidGraphNode {
  return {
    pid: 13,
    ppid: 10,
    command: "grep",
    argv: ["grep", "--line-buffered", "match"],
    cwd: "/",
    exe: "/usr/bin/grep",
  };
}

function extraGrepNode(): MovePidGraphNode {
  return {
    pid: 14,
    ppid: 10,
    command: "grep",
    argv: ["grep", "line"],
    cwd: "/",
    exe: "/usr/bin/grep",
  };
}
