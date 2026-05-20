import { describe, expect, it } from "vitest";
import {
  NodeRuntimeAdapterUnsupportedError,
  captureNodeNativeResources,
  captureNodeRuntimeAdapterDocument,
  restoreNodeCapturedResourceRecipes,
} from "../node-runtime-adapter.ts";

describe("Node native resource capture", () => {
  it("captures argv/env/cwd and regular file recipes deterministically", () => {
    const resources = captureNodeNativeResources({
      argv: ["node", "server.mjs"],
      env: { PORT: "8080" },
      cwd: "/work/app",
      files: [
        { id: "file:state", path: "/work/app/state.json", flags: ["read", "write"], offset: 12 },
      ],
    });

    expect(resources.unsupported.refusals).toEqual([]);
    expect(restoreNodeCapturedResourceRecipes(resources)).toEqual({
      argv: ["node", "server.mjs"],
      env: { PORT: "8080" },
      cwd: "/work/app",
      files: [
        { id: "file:state", path: "/work/app/state.json", flags: ["read", "write"], offset: 12 },
      ],
    });
  });

  it("reports stdio and native handles as stable actionable refusals", () => {
    const resources = captureNodeNativeResources({
      includeStdioRefusals: true,
      nativeHandleRefusals: [
        {
          id: "node:socket:server",
          kind: "socket",
          message: "listening sockets need host port rebinding",
        },
        {
          id: "node:timer:queue",
          kind: "timer",
          message: "timers need async continuation metadata",
        },
        {
          id: "node:pty:session",
          kind: "pty",
          message: "PTY sessions need host capability recreation",
        },
      ],
    });

    expect(resources.resources.map((resource) => resource.id)).toEqual(
      expect.arrayContaining([
        "node:stdio:0",
        "node:stdio:1",
        "node:stdio:2",
        "node:socket:server",
      ]),
    );
    expect(resources.unsupported.refusals.map((refusal) => refusal.code)).toEqual(
      expect.arrayContaining([
        "fd-kind-unsupported",
        "resource-unsupported",
        "runtime-heap-unsupported",
      ]),
    );
    expect(() => restoreNodeCapturedResourceRecipes(resources)).toThrow(
      NodeRuntimeAdapterUnsupportedError,
    );
  });

  it("carries native resource refusals into the Node adapter document", () => {
    const document = captureNodeRuntimeAdapterDocument(
      { state: { ok: true } },
      {
        process: { argv: ["node", "app.mjs"], env: { APP: "1" }, cwd: "/app" },
        files: [{ id: "file:config", path: "/app/config.json", flags: ["read"] }],
        includeStdioRefusals: true,
        nativeHandleRefusals: [
          { id: "node:worker:1", kind: "worker", message: "workers need thread handoff metadata" },
        ],
      },
    );

    expect(document.resources.resources.map((resource) => resource.id)).toContain("file:config");
    expect(document.resources.unsupported.refusals.map((refusal) => refusal.code)).toContain(
      "fd-kind-unsupported",
    );
    expect(document.restore).toMatchObject({
      semanticStateSupported: false,
      refusal: { code: "fd-kind-unsupported" },
    });
  });
});
