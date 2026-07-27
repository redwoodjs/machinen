import type { DesktopSnapshot } from "@machinen/desktop-sdk";
import { describe, expect, it } from "vitest";

import { DesktopState } from "../desktop-state.js";
import { activityWidget } from "./activity-status.js";

function stateFor(activityStates: Array<"working" | "waiting" | "idle" | "unknown">): DesktopState {
  const snapshot: DesktopSnapshot = {
    workspaces: [
      {
        id: "ws_test",
        name: "test",
        machineId: "local",
        location: { kind: "local", path: "/tmp/project" },
        workingDirectory: "/tmp/project",
        position: 0,
        tileIds: activityStates.map((_, index) => `tile_${index}`),
      },
    ],
    tiles: activityStates.map((_, index) => ({
      id: `tile_${index}`,
      workspaceId: "ws_test",
      kind: "terminal",
      name: `terminal ${index}`,
      label: "",
      pid: index + 10,
      shellPid: index + 10,
      position: index,
      terminalId: `term_${index}`,
      viewerState: "attached",
    })),
    terminals: activityStates.map((activityState, index) => ({
      id: `term_${index}`,
      tileId: `tile_${index}`,
      pid: index + 10,
      shellPid: index + 10,
      workingDirectory: "/tmp/project",
      location: { kind: "local", path: "/tmp/project" },
      backend: "machinenSession",
      processState: "running",
      activityState,
      viewerState: "attached",
    })),
    ui: {
      level: "workspace",
      selectedWorkspaceId: "ws_test",
      selectedTileId: "tile_0",
      focusedTileId: null,
    },
  };
  const state = new DesktopState();
  state.load(snapshot);
  return state;
}

describe("Activity status service", () => {
  it("publishes the selected workspace's terminal states", () => {
    expect(activityWidget(stateFor(["working", "waiting", "idle"]))).toMatchObject({
      id: "machinen.activity",
      scope: { kind: "workspace", id: "ws_test" },
      kind: "state",
      tone: "attention",
      tooltip: "1 waiting · 1 active · 1 idle",
      states: ["working", "waiting", "idle"],
      ttlMilliseconds: 10_000,
    });
  });

  it("reports exited terminals as errors", () => {
    const state = stateFor(["idle"]);
    const terminal = state.terminals.get("term_0");
    if (terminal) {
      terminal.processState = "exited";
    }

    expect(activityWidget(state)).toMatchObject({
      tone: "error",
      tooltip: "1 error",
      states: ["error"],
    });
  });
});
