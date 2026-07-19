import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MachinenClient } from "./machinen-client.js";
import { createMachinenMcpServer } from "./server.js";

async function main(): Promise<void> {
  const client = new MachinenClient();
  const server = createMachinenMcpServer(client);
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
