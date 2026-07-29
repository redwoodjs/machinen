import type { DesktopSnapshot, StatusWidget } from "@machinen/desktop-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DesktopState } from "../desktop-state.js";
import {
  MetricsStatusService,
  parseNetworkBytes,
  parseNetworkInterfaces,
  parseProcessElapsedCPU,
  processTree,
} from "./metrics-status.js";

const services: MetricsStatusService[] = [];

afterEach(() => {
  for (const service of services) {
    service.stop();
  }
  services.length = 0;
});

const overviewSnapshot: DesktopSnapshot = {
  workspaces: [],
  tiles: [],
  terminals: [],
  ui: {
    level: "overview",
    selectedWorkspaceId: null,
    selectedTileId: null,
    focusedTileId: null,
  },
};

function workspaceSnapshot(): DesktopSnapshot {
  return {
    workspaces: [
      {
        id: "ws_test",
        name: "test",
        machineId: "local",
        location: { kind: "local", path: "/tmp/project" },
        workingDirectory: "/tmp/project",
        position: 0,
        tileIds: ["tile_test"],
      },
    ],
    tiles: [
      {
        id: "tile_test",
        workspaceId: "ws_test",
        kind: "terminal",
        name: "shell",
        label: "",
        pid: 42,
        shellPid: 40,
        position: 0,
        terminalId: "term_test",
        viewerState: "attached",
      },
    ],
    terminals: [
      {
        id: "term_test",
        tileId: "tile_test",
        pid: 42,
        shellPid: 40,
        workingDirectory: "/tmp/project",
        currentWorkingDirectory: null,
        location: { kind: "local", path: "/tmp/project" },
        backend: "machinenSession",
        processState: "running",
        activityState: "idle",
        viewerState: "attached",
      },
    ],
    ui: {
      level: "terminal",
      selectedWorkspaceId: "ws_test",
      selectedTileId: "tile_test",
      focusedTileId: "tile_test",
    },
  };
}

describe("Metrics status service", () => {
  it("parses one link-layer row per active network interface", () => {
    const output = `Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
lo0 16384 <Link#1> 10 0 100 10 0 100 0
en0 1500 <Link#4> aa:bb:cc:dd:ee:ff 20 0 2000 30 0 3000 0
en0 1500 192.168.1 192.168.1.2 20 - 2000 30 - 3000 -
gif0* 1280 <Link#2> 0 0 50 0 0 60 0
`;

    expect(parseNetworkInterfaces(output)).toEqual({ incoming: 2_000, outgoing: 3_000 });
  });

  it("finds descendant CPU totals and aggregates nettop rows", () => {
    const rows = parseProcessElapsedCPU(" 10 1 0:01.50\n 11 10 0:02.25\n 12 99 1-01:00:00.00\n");
    expect(processTree(rows, [10])).toEqual([
      { pid: 10, parentPID: 1, cpuSeconds: 1.5 },
      { pid: 11, parentPID: 10, cpuSeconds: 2.25 },
    ]);
    expect(
      parseNetworkBytes("time,,bytes_in,bytes_out\n12:00,node,100,200\n12:00,child,30,40\n"),
    ).toEqual({ incoming: 130, outgoing: 240 });
  });

  it("publishes overview CPU and network widgets", async () => {
    const state = new DesktopState();
    state.load(overviewSnapshot);
    const set = vi.fn(async (_widget: StatusWidget) => ({}));
    const samples = [
      { cpuUsed: 100, cpuTotal: 1_000, incoming: 1_000, outgoing: 2_000, sampledAt: 0 },
      { cpuUsed: 200, cpuTotal: 1_200, incoming: 3_000, outgoing: 5_000, sampledAt: 1_000 },
    ];
    let sample = 0;
    const service = new MetricsStatusService({ status: { set } }, state, {
      pollIntervalMilliseconds: 20,
      hostProbe: vi.fn(async () => samples[Math.min(sample++, samples.length - 1)]),
    });
    services.push(service);

    service.start(overviewSnapshot);

    await vi.waitFor(() => expect(set.mock.calls.length).toBeGreaterThanOrEqual(2));
    service.stop();
    expect(set.mock.calls.slice(0, 2).map(([widget]) => widget.id)).toEqual([
      "machinen.cpu",
      "machinen.network",
    ]);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "machinen.cpu",
        scope: { kind: "global" },
        value: "50%",
        ttlMilliseconds: 3_000,
      }),
    );
  });

  it("publishes focused CPU and network widgets", async () => {
    const snapshot = workspaceSnapshot();
    const state = new DesktopState();
    state.load(snapshot);
    const set = vi.fn(async (_widget: StatusWidget) => ({}));
    const samples = [
      { cpuSeconds: 10, incoming: 1_000, outgoing: 2_000, sampledAt: 0 },
      { cpuSeconds: 10.5, incoming: 3_000, outgoing: 5_000, sampledAt: 1_000 },
    ];
    let sample = 0;
    const service = new MetricsStatusService({ status: { set } }, state, {
      pollIntervalMilliseconds: 20,
      processProbe: vi.fn(async () => samples[Math.min(sample++, samples.length - 1)]),
    });
    services.push(service);

    service.start(snapshot);

    await vi.waitFor(() => expect(set.mock.calls.length).toBeGreaterThanOrEqual(2));
    service.stop();
    expect(set.mock.calls.slice(0, 2).map(([widget]) => widget.id)).toEqual([
      "machinen.pid.cpu",
      "machinen.pid.network",
    ]);
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "machinen.pid.cpu",
        scope: { kind: "terminal", id: "term_test" },
        value: "50%",
        ttlMilliseconds: 10_000,
      }),
    );
  });
});
