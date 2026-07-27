import { MachinenDesktopClient } from "@machinen/desktop-sdk";

import { DesktopState } from "./desktop-state.js";
import { ActivityStatusService } from "./services/activity-status.js";
import { GitStatusService } from "./services/git-status.js";
import { MetricsStatusService } from "./services/metrics-status.js";
import { OpenPortsService } from "./services/open-ports.js";

const desktop = new MachinenDesktopClient({
  client: { name: "machinen-desktop-services", version: "0.1.0" },
  launchApplication: false,
  initialSubscription: {
    events: ["workspace.*", "tile.*", "terminal.*", "ui.changed", "system.shuttingDown"],
    includeSnapshot: true,
  },
});
const state = new DesktopState();
const activityStatus = new ActivityStatusService(desktop, state);
const gitStatus = new GitStatusService(desktop, state);
const openPorts = new OpenPortsService(desktop, state);
const metricsStatus = new MetricsStatusService(desktop, state);

desktop.onConnect(({ subscription }) => {
  if (subscription?.snapshot) {
    state.load(subscription.snapshot);
    activityStatus.start(subscription.snapshot);
    gitStatus.start(subscription.snapshot);
    openPorts.start(subscription.snapshot);
    metricsStatus.start(subscription.snapshot);
  }
});
desktop.onEvent((event) => {
  if (event.event === "system.shuttingDown") {
    shutdown();
    return;
  }
  state.handleEvent(event);
  activityStatus.handleEvent(event);
  gitStatus.handleEvent(event);
  openPorts.handleEvent(event);
  metricsStatus.handleEvent(event);
});
desktop.onDisconnect((error) => {
  console.error(`Machinen Desktop services disconnected: ${error.message}`);
});

function shutdown(): void {
  activityStatus.stop();
  gitStatus.stop();
  openPorts.stop();
  metricsStatus.stop();
  desktop.close();
}

process.once("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.once("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

await desktop.connect();
