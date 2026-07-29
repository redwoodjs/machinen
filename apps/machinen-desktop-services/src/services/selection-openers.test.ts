import { posix as path } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import type { SelectionOpenerInvocation, MachinenDesktopClient } from "@machinen/desktop-sdk";

import {
  SelectionOpenersService,
  selectionOpeners,
  firstExistingLocalMarkdownPath,
  firstExistingLocalPath,
  firstExistingWorkspacePath,
  localizeMarkdownPath,
  markdownPathFromSelection,
  markdownPathsFromSelection,
  pathsFromSelection,
} from "./selection-openers.js";

describe("selection openers", () => {
  it("extracts Markdown paths from larger selections", () => {
    expect(markdownPathFromSelection("docs/guide.md")).toBe("docs/guide.md");
    expect(markdownPathFromSelection("Open `notes/today.markdown` when ready.")).toBe(
      "notes/today.markdown",
    );
    expect(markdownPathFromSelection("See [the guide](docs/guide.md#setup) next.")).toBe(
      "docs/guide.md",
    );
    expect(markdownPathFromSelection("Failure at docs/guide.md:42:7 during build")).toBe(
      "docs/guide.md",
    );
    expect(markdownPathsFromSelection("Compare one.md with two.md")).toEqual(["one.md", "two.md"]);
    expect(markdownPathFromSelection("not markdown")).toBeUndefined();
    expect(selectionOpeners.map((opener) => opener.title)).toEqual(["Glow", "Yazi", "Finder"]);
    expect(selectionOpeners[0]!.selectionPattern).toBeUndefined();
    expect(selectionOpeners[2]!.locationKinds).toEqual(["local"]);
  });

  it("extracts non-Markdown paths for Finder", () => {
    expect(pathsFromSelection("Reveal [the docs](../docs) in Finder")).toContain("../docs");
  });

  it("resolves file-manager paths against the workspace folder", async () => {
    const exists = (candidate: string): boolean => candidate === "/workspace/companies/p4p8";
    expect(firstExistingLocalPath(["companies/p4p8"], "/workspace", "/workspace", exists)).toBe(
      "/workspace/companies/p4p8",
    );
    await expect(
      firstExistingWorkspacePath(["companies/p4p8"], "/workspace", async (candidate) =>
        exists(candidate),
      ),
    ).resolves.toBe("/workspace/companies/p4p8");
    await expect(
      firstExistingWorkspacePath(
        ["skip/art/concepts/pierneef-research-options/"],
        "/Users/p4p8/gh/peterp/skip",
        async (candidate) =>
          candidate === "/Users/p4p8/gh/peterp/skip/art/concepts/pierneef-research-options",
      ),
    ).resolves.toBe("/Users/p4p8/gh/peterp/skip/art/concepts/pierneef-research-options");
  });

  it("maps an absolute path from another home to the matching local workspace", () => {
    const localPath = "/Users/p4p8/gh/peterp/notes/README.md";
    expect(
      localizeMarkdownPath(
        "/Users/peterp/gh/peterp/notes/README.md",
        "/Users/p4p8/gh/peterp/notes",
        (candidate) => candidate === localPath,
      ),
    ).toBe(localPath);
  });

  it("chooses the first candidate that exists in the local workspace", () => {
    expect(
      firstExistingLocalMarkdownPath(
        ["missing.md", "docs/guide.md"],
        "/project",
        "/project",
        (candidate) => candidate === "/project/docs/guide.md",
      ),
    ).toBe("/project/docs/guide.md");
  });

  it("registers the editable openers and opens Glow with an argv launch", async () => {
    const absoluteMarkdownPath = fileURLToPath(new URL("../../README.md", import.meta.url));
    const workingDirectory = path.dirname(absoluteMarkdownPath);
    const markdownPath = path.basename(absoluteMarkdownPath);
    const set = vi.fn().mockResolvedValue({});
    const request = vi.fn().mockResolvedValue({});
    const desktop = {
      selectionOpeners: { set },
      request,
    } as unknown as MachinenDesktopClient;
    const service = new SelectionOpenersService(desktop);
    service.start();
    await vi.waitFor(() => expect(set).toHaveBeenCalledTimes(selectionOpeners.length));

    const invocation: SelectionOpenerInvocation = {
      invocationId: "inv_1",
      openerId: selectionOpeners[0]!.id,
      selection: `Please open [the service docs](${markdownPath}) before continuing.`,
      workspaceId: "ws_1",
      tileId: "tile_1",
      terminalId: "term_1",
      workingDirectory,
      location: { kind: "local", path: workingDirectory },
    };
    service.handleEvent({
      type: "event",
      seq: 1,
      event: "selectionOpener.invoked",
      data: invocation,
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith("tile.create", {
      workspaceId: "ws_1",
      kind: "terminal",
      name: "glow README.md",
      terminal: {
        workingDirectory,
        launch: {
          kind: "exec",
          executable: "/usr/bin/env",
          arguments: ["glow", "--pager", absoluteMarkdownPath],
          environment: {
            PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
          },
        },
      },
      focus: true,
    });
    service.stop();
  });

  it("publishes visible feedback when an opener cannot resolve the selection", async () => {
    const set = vi.fn().mockResolvedValue({});
    const desktop = { status: { set } } as unknown as MachinenDesktopClient;
    const service = new SelectionOpenersService(desktop);
    service.handleEvent({
      type: "event",
      seq: 2,
      event: "selectionOpener.invoked",
      data: {
        invocationId: "inv_missing",
        openerId: selectionOpeners[1]!.id,
        selection: "definitely/missing/path",
        workspaceId: "ws_1",
        tileId: "tile_1",
        terminalId: "term_1",
        workingDirectory: "/tmp",
        location: { kind: "local", path: "/tmp" },
      },
    });

    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        value: "Yazi failed",
        tone: "error",
        tooltip: "the selection does not resolve against the workspace",
      }),
    );
  });

  it("opens Yazi at a validated selection in the same workspace", async () => {
    const selectedPath = fileURLToPath(new URL("../../README.md", import.meta.url));
    const workspacePath = path.dirname(selectedPath);
    const request = vi.fn().mockResolvedValue({});
    const desktop = { request } as unknown as MachinenDesktopClient;
    await selectionOpeners[1]!.open(
      {
        invocationId: "inv_yazi",
        openerId: selectionOpeners[1]!.id,
        selection: path.basename(selectedPath),
        workspaceId: "ws_1",
        tileId: "tile_1",
        terminalId: "term_1",
        workingDirectory: "/tmp",
        location: { kind: "local", path: workspacePath },
      },
      desktop,
    );

    expect(request).toHaveBeenCalledWith("tile.create", {
      workspaceId: "ws_1",
      kind: "terminal",
      name: "yazi README.md",
      terminal: {
        workingDirectory: workspacePath,
        launch: {
          kind: "exec",
          executable: "/usr/bin/env",
          arguments: ["yazi", selectedPath],
          environment: {
            PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
            TERM_PROGRAM: "ghostty",
          },
        },
      },
      focus: true,
    });
  });
});
