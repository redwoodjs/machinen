import type { MoveDescriptor, MovePidGraphNode, VmHandle } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import {
  readMoveDdState,
  readMoveFindStateInVm,
  readMoveHttpState,
  readMoveNodeStaticHttpStateInVm,
  readMoveReaderStateInVm,
  readMoveTailGrepPipelineState,
  readMoveTarState,
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

  it("omits node static http state without the marker", async () => {
    const state = await readMoveNodeStaticHttpStateInVm(
      mockVm("const PORT = 8130;\n"),
      nodeStaticNode(),
      httpResourcePlan(1),
    );

    expect(state).toBeUndefined();
  });

  it("captures idle python http server only with one listener socket", () => {
    expect(readMoveHttpState(httpNode(), httpResourcePlan(1))).toMatchObject({
      executable: "python3",
      port: 8123,
      cwd: "/tmp/web",
    });
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

function mockVm(stdout = "12\n"): VmHandle {
  return {
    execRaw: async () => ({ exitCode: 0, stdout, stderr: "" }),
  } as unknown as VmHandle;
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
