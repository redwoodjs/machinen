import { describe, expect, it, vi } from "vitest";

import type { ContextCommandInvocation, MachinenDesktopClient } from "@machinen/desktop-sdk";

import { ContextCommandsService, contextCommands } from "./context-commands.js";

describe("context commands", () => {
  it("registers workspace and terminal-directory commands", async () => {
    const set = vi.fn().mockResolvedValue({});
    const request = vi.fn().mockResolvedValue({});
    const desktop = {
      commands: { set },
      request,
    } as unknown as MachinenDesktopClient;
    const service = new ContextCommandsService(desktop);
    service.start();

    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(contextCommands.length));
    expect(contextCommands.map((command) => [command.title, command.context])).toEqual([
      ["Open terminal directory in Glow", "terminal"],
      ["Open terminal directory in Yazi", "terminal"],
      ["Open workspace in Glow", "workspace"],
      ["Open workspace in Yazi", "workspace"],
    ]);

    const yazi = contextCommands.find(
      (command) => command.id === "machinen.yazi-terminal-directory",
    )!;
    const invocation: ContextCommandInvocation = {
      invocationId: "inv_yazi",
      commandId: yazi.id,
      context: "terminal",
      workspaceId: "ws_1",
      tileId: "tile_1",
      terminalId: "term_1",
      workingDirectory: "/workspace/packages/runtime",
      location: { kind: "ssh", host: "mini", path: "/workspace/packages/runtime" },
    };
    service.handleEvent({
      type: "event",
      seq: 1,
      event: "command.invoked",
      data: invocation,
    });

    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith("tile.create", {
      workspaceId: "ws_1",
      kind: "terminal",
      name: "yazi runtime",
      terminal: {
        workingDirectory: "/workspace/packages/runtime",
        launch: {
          kind: "exec",
          executable: "/usr/bin/env",
          arguments: ["yazi", "/workspace/packages/runtime"],
          environment: {
            PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            TERM_PROGRAM: "ghostty",
          },
        },
      },
      focus: true,
    });
    service.stop();
  });

  it("runs Glow against a workspace directory", async () => {
    const request = vi.fn().mockResolvedValue({});
    const desktop = { request } as unknown as MachinenDesktopClient;
    const glow = contextCommands.find((command) => command.id === "machinen.glow-workspace")!;
    await glow.run(
      {
        invocationId: "inv_glow",
        commandId: glow.id,
        context: "workspace",
        workspaceId: "ws_1",
        workingDirectory: "/workspace",
        location: { kind: "local", path: "/workspace" },
      },
      desktop,
    );

    expect(request).toHaveBeenCalledWith(
      "tile.create",
      expect.objectContaining({
        workspaceId: "ws_1",
        terminal: expect.objectContaining({
          workingDirectory: "/workspace",
          launch: expect.objectContaining({ arguments: ["glow", "--tui", "/workspace"] }),
        }),
      }),
    );
  });
});
