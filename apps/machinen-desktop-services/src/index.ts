import { MachinenDesktopClient } from "@machinen/desktop-sdk";

import { DesktopState } from "./desktop-state.js";
import { ContextCommandsService } from "./services/context-commands.js";
import { SelectionOpenersService } from "./services/selection-openers.js";
import { GitStatusService } from "./services/git-status.js";
import { MetricsStatusService } from "./services/metrics-status.js";
import { OpenPortsService } from "./services/open-ports.js";

const desktop = new MachinenDesktopClient({
  client: { name: "machinen-desktop-services", version: "0.1.0" },
  launchApplication: false,
  initialSubscription: {
    events: [
      "workspace.*",
      "tile.*",
      "terminal.*",
      "command.*",
      "selectionOpener.*",
      "ui.changed",
      "system.shuttingDown",
    ],
    includeSnapshot: true,
  },
});
const state = new DesktopState();
const contextCommandsService = new ContextCommandsService(desktop);
const selectionOpenersService = new SelectionOpenersService(desktop);
const gitStatus = new GitStatusService(desktop, state);
const openPorts = new OpenPortsService(desktop, state);
const metricsStatus = new MetricsStatusService(desktop, state);
let isShuttingDown = false;

desktop.onConnect(({ subscription }) => {
  if (subscription?.snapshot) {
    state.load(subscription.snapshot);
    contextCommandsService.start();
    selectionOpenersService.start();
    gitStatus.start(subscription.snapshot);
    openPorts.start(subscription.snapshot);
    metricsStatus.start(subscription.snapshot);
  }
});
desktop.onEvent((event) => {
  if (event.event === "system.shuttingDown") {
    shutdownAndExit();
    return;
  }
  state.handleEvent(event);
  contextCommandsService.handleEvent(event);
  selectionOpenersService.handleEvent(event);
  gitStatus.handleEvent(event);
  openPorts.handleEvent(event);
  metricsStatus.handleEvent(event);
});
desktop.onDisconnect((error) => {
  console.error(`Machinen Desktop services disconnected: ${error.message}`);
});

function shutdown(): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  contextCommandsService.stop();
  selectionOpenersService.stop();
  gitStatus.stop();
  openPorts.stop();
  metricsStatus.stop();
  desktop.close();
}

function shutdownAndExit(): void {
  shutdown();
  process.exit(0);
}

process.once("SIGINT", shutdownAndExit);
process.once("SIGTERM", shutdownAndExit);
if (process.env.MACHINEN_DESKTOP_SUPERVISED === "1") {
  process.stdin.resume();
  process.stdin.once("end", shutdownAndExit);
  process.stdin.once("error", shutdownAndExit);
}

await desktop.connect();
