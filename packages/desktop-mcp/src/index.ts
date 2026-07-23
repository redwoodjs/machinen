import { MachinenDesktopClient } from "@machinen/desktop-sdk";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMachinenDesktopMcpServer } from "./server.js";

async function main(): Promise<void> {
  const client = new MachinenDesktopClient({
    client: { name: "machinen-desktop-mcp", version: "0.1.0" },
    initialSubscription: {
      events: ["workspace.*", "tile.*", "terminal.*", "ui.changed"],
      includeOutput: true,
      includeSnapshot: true,
    },
  });
  const server = createMachinenDesktopMcpServer(client);
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    client.close();
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await server.connect(transport);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
