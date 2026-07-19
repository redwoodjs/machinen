import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MachinenClient } from "./machinen-client.js";
import { registerMachinenTools } from "./tools.js";

export function createMachinenMcpServer(client = new MachinenClient()): McpServer {
  const server = new McpServer({
    name: "machinen",
    version: "0.1.0",
  });
  registerMachinenTools(server, client);
  return server;
}
