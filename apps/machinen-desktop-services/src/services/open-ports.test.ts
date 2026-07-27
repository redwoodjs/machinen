import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { DesktopSnapshot, StatusWidget, WorkspaceLocation } from "@machinen/desktop-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopState } from "../desktop-state.js";
import {
  openPortsWidget,
  OpenPortsService,
  parseOpenPortsOutput,
  portsProbeScript,
  type ListeningService,
} from "./open-ports.js";

const execute = promisify(execFile);
const services: OpenPortsService[] = [];

afterEach(() => {
  for (const service of services) {
    service.stop();
  }
  services.length = 0;
});

const snapshot: DesktopSnapshot = {
  workspaces: [
    {
      id: "ws_test",
      name: "test",
      machineId: "ssh:mini",
      location: { kind: "ssh", host: "p4p8@mini", path: "/tmp/project" },
      workingDirectory: "/tmp/project",
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

describe("Open ports service", () => {
  it("keeps only listeners whose process is inside the workspace", () => {
    const output = `---MACHINEN-PORTS-ROOT---
/tmp/project
---MACHINEN-PORTS-LISTENERS---
p10
cnode
n127.0.0.1:3000
n[::1]:3000
p11
cssh
n127.0.0.1:11435
p12
cvite
n*:4173
---MACHINEN-PORTS-CWDS---
p10
fcwd
n/tmp/project/apps/web
p11
fcwd
n/tmp
p12
fcwd
n/tmp/project-other
`;

    expect(parseOpenPortsOutput(output)).toEqual([
      {
        process: "node",
        pid: 10,
        port: 3000,
        addresses: ["127.0.0.1:3000", "[::1]:3000"],
      },
    ]);
  });

  it("emits parseable output when the POSIX shell runs the probe", async () => {
    const root = await mkdtemp(join(tmpdir(), "machinen-open-ports-test-"));
    const workspace = join(root, "workspace");
    const bin = join(root, "bin");
    const lsof = join(bin, "lsof");
    try {
      await mkdir(workspace);
      await mkdir(bin);
      await writeFile(
        lsof,
        `#!/bin/sh
case "$*" in
  *-iTCP*) printf 'p10\\ncnode\\nn127.0.0.1:3000\\n' ;;
  *) printf 'p10\\nfcwd\\nn%s\\n' "$TEST_WORKSPACE" ;;
esac
`,
      );
      await chmod(lsof, 0o755);

      const { stdout } = await execute("/bin/sh", ["-c", portsProbeScript('"$TEST_WORKSPACE"')], {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_WORKSPACE: await realpath(workspace),
        },
      });

      expect(parseOpenPortsOutput(stdout)).toEqual([
        {
          process: "node",
          pid: 10,
          port: 3000,
          addresses: ["127.0.0.1:3000"],
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("publishes workspace-scoped browser links", () => {
    const listeners: ListeningService[] = [
      { process: "node", pid: 10, port: 3000, addresses: ["127.0.0.1:3000"] },
    ];

    expect(openPortsWidget(snapshot.workspaces[0], listeners)).toMatchObject({
      id: "machinen.services",
      scope: { kind: "workspace", id: "ws_test" },
      value: "1",
      tooltip: "node 127.0.0.1:3000",
      links: [
        {
          title: "node 127.0.0.1:3000 — http://mini:3000",
          url: "http://mini:3000",
        },
      ],
    });
  });

  it("probes the selected workspace and publishes its listeners", async () => {
    const state = new DesktopState();
    state.load(snapshot);
    const set = vi.fn(async (_widget: StatusWidget) => ({}));
    const listeners: ListeningService[] = [
      { process: "vite", pid: 12, port: 4173, addresses: ["*:4173"] },
    ];
    const probe = vi.fn(async (_location: WorkspaceLocation, _signal?: AbortSignal) => listeners);
    const service = new OpenPortsService({ status: { set } }, state, {
      pollIntervalMilliseconds: 60_000,
      probe,
    });
    services.push(service);

    service.start(snapshot);

    await vi.waitFor(() => expect(set).toHaveBeenCalledOnce());
    expect(probe).toHaveBeenCalledWith(snapshot.workspaces[0].location, expect.any(AbortSignal));
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "machinen.services",
        scope: { kind: "workspace", id: "ws_test" },
        value: "1",
        ttlMilliseconds: 10_000,
      }),
    );
  });
});
