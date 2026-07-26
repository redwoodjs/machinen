import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { DesktopSnapshot, StatusWidget, WorkspaceLocation } from "@machinen/desktop-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  formatCompactCount,
  GitStatusService,
  parseGitOutput,
  probeGit,
  remoteGitProbeCommand,
  remoteShellPath,
  type GitMetrics,
} from "./git-status.js";

const execute = promisify(execFile);
const services: GitStatusService[] = [];

afterEach(() => {
  for (const service of services) {
    service.stop();
  }
  services.length = 0;
});

describe("Git status service", () => {
  it("parses branch-wide commits and numstat into status bars", () => {
    const metrics = parseGitOutput(
      `main\n---MACHINEN-BRANCH-COMMITS---\n2\n---MACHINEN-BRANCH-NUMSTAT---\n3\t1\tsrc/a.ts\n19\t2\tsrc/new.ts\n`,
    );

    expect(metrics).toEqual({
      branch: "main",
      commits: 2,
      filesChanged: 2,
      additions: 22,
      deletions: 3,
      additionBars: [19, 3],
      deletionBars: [2, 1],
    });
  });

  it("handles a clean branch", () => {
    const metrics = parseGitOutput(
      "main\n---MACHINEN-BRANCH-COMMITS---\n0\n---MACHINEN-BRANCH-NUMSTAT---\n",
    );

    expect(metrics).toEqual({
      branch: "main",
      commits: 0,
      filesChanged: 0,
      additions: 0,
      deletions: 0,
      additionBars: [0],
      deletionBars: [0],
    });
  });

  it("compacts large line counts", () => {
    expect(formatCompactCount(19_000)).toBe("19K");
    expect(formatCompactCount(1_250_000)).toBe("1.3M");
  });

  it("probes a local repository whose path contains spaces", async () => {
    const root = await mkdtemp(join(tmpdir(), "machinen-git-status-test-"));
    const repository = join(root, "repo with spaces");
    try {
      await mkdir(repository);
      await execute("/usr/bin/git", ["init", "-b", "main", repository]);
      await writeFile(join(repository, "new file.txt"), "hello\n");

      const metrics = await probeGit({ kind: "local", path: repository });

      expect(metrics).toMatchObject({
        branch: "main",
        commits: 0,
        filesChanged: 1,
        additions: 1,
        deletions: 0,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("quotes absolute and home-relative remote paths", () => {
    expect(remoteShellPath("~/gh/peter's repo")).toBe(`"$HOME"/'gh/peter'\\''s repo'`);
    expect(remoteShellPath("/Users/p4p8/project")).toBe("'/Users/p4p8/project'");
    expect(remoteGitProbeCommand("~/project")).toContain(`cd "$HOME"/'project' || exit 1`);
  });

  it("publishes machinen.git for the selected workspace", async () => {
    const set = vi.fn(async (_widget: StatusWidget) => ({}));
    const metrics: GitMetrics = {
      branch: "feature",
      commits: 3,
      filesChanged: 1,
      additions: 19_000,
      deletions: 1_250_000,
      additionBars: [19_000],
      deletionBars: [1_250_000],
    };
    const probe = vi.fn(async (_location: WorkspaceLocation, _signal?: AbortSignal) => metrics);
    const service = new GitStatusService(
      { status: { set } },
      { pollIntervalMilliseconds: 60_000, probe },
    );
    services.push(service);
    const snapshot: DesktopSnapshot = {
      workspaces: [
        {
          id: "ws_test",
          name: "test",
          machineId: "ssh:mini",
          location: { kind: "ssh", host: "mini", path: "~/project" },
          workingDirectory: "~/project",
          position: 0,
          tileIds: [],
        },
      ],
      tiles: [],
      terminals: [],
      ui: {
        level: "workspace",
        selectedWorkspaceId: "ws_test",
        selectedTileId: null,
        focusedTileId: null,
      },
    };

    service.start(snapshot);

    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    expect(probe).toHaveBeenCalledWith(snapshot.workspaces[0].location, expect.any(AbortSignal));
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "machinen.git",
        scope: { kind: "workspace", id: "ws_test" },
        kind: "sparkline",
        graphStyle: "bars",
        label: "feature",
        value: "+19K −1.3M",
        tooltip: "3 commits · 1 files\n+19000 additions · −1250000 deletions",
        ttlMilliseconds: 10_000,
      }),
    );
  });
});
