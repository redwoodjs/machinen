import { MachinenDesktopClient } from "@machinen/desktop-sdk";

import { DesktopState } from "./desktop-state.js";
import { ActivityStatusService } from "./services/activity-status.js";
import { GitStatusService } from "./services/git-status.js";
import { MetricsStatusService } from "./services/metrics-status.js";
import { OpenPortsService } from "./services/open-ports.js";
import type { DesktopService } from "./workspace-polling-service.js";

const desktop = new MachinenDesktopClient({
  client: { name: "machinen-desktop-services", version: "0.1.0" },
  launchApplication: false,
  initialSubscription: {
    events: ["workspace.*", "tile.*", "terminal.*", "ui.changed", "system.shuttingDown"],
    includeSnapshot: true,
  },
});
const state = new DesktopState();
const services: DesktopService[] = [
  new ActivityStatusService(desktop, state),
  new GitStatusService(desktop, state),
  new OpenPortsService(desktop, state),
  new MetricsStatusService(desktop, state),
];

desktop.onConnect(({ subscription }) => {
  if (subscription?.snapshot) {
    state.load(subscription.snapshot);
    for (const service of services) {
      service.start(subscription.snapshot);
    }
  }
});
desktop.onEvent((event) => {
  if (event.event === "system.shuttingDown") {
    shutdown();
    return;
  }
  state.handleEvent(event);
  for (const service of services) {
    service.handleEvent(event);
  }
});
desktop.onDisconnect((error) => {
  console.error(`Machinen Desktop services disconnected: ${error.message}`);
});

function shutdown(): void {
  for (const service of services) {
    service.stop();
  }
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
