import { MachinenDesktopClient } from "@machinen/desktop-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerMachinenTools } from "./tools.js";

export function createMachinenDesktopMcpServer(client = new MachinenDesktopClient()): McpServer {
  const server = new McpServer({
    name: "machinen-desktop",
    version: "0.1.0",
  });
  registerMachinenTools(server, client);
  return server;
}
