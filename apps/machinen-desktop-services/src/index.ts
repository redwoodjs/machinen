import { MachinenDesktopClient } from "@machinen/desktop-sdk";

import { GitStatusService } from "./services/git-status.js";

const desktop = new MachinenDesktopClient({
  client: { name: "machinen-desktop-services", version: "0.1.0" },
  launchApplication: false,
  initialSubscription: {
    events: ["workspace.*", "ui.changed", "system.shuttingDown"],
    includeSnapshot: true,
  },
});
const gitStatus = new GitStatusService(desktop);

desktop.onConnect(({ subscription }) => {
  if (subscription?.snapshot) {
    gitStatus.start(subscription.snapshot);
  }
});
desktop.onEvent((event) => {
  if (event.event === "system.shuttingDown") {
    shutdown();
    return;
  }
  gitStatus.handleEvent(event);
});
desktop.onDisconnect((error) => {
  console.error(`Machinen Desktop services disconnected: ${error.message}`);
});

function shutdown(): void {
  gitStatus.stop();
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
