import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MachinenClient,
  type JsonObject,
  type TerminalOutput,
  type TerminalWaitOptions,
} from "../machinen-client.js";
import { createMachinenMcpServer } from "../server.js";

class FakeMachinenClient extends MachinenClient {
  requests: { operation: string; params: JsonObject; idempotencyKey?: string }[] = [];

  constructor() {
    super("/tmp/not-used.sock");
  }

  override async request(
    operation: string,
    params: JsonObject = {},
    idempotencyKey?: string,
  ): Promise<unknown> {
    this.requests.push({ operation, params, idempotencyKey });
    if (operation === "system.snapshot") {
      return { workspaces: [], tiles: [], terminals: [], ui: { level: "overview" } };
    }
    if (operation === "workspace.create") {
      return { id: "ws_test", name: params.name };
    }
    if (operation === "terminal.send") {
      return { terminalId: params.terminalId, bytesWritten: 6 };
    }
    return {};
  }

  override readTerminalOutput(terminalId: string): TerminalOutput {
    return {
      terminalId,
      startCursor: 0,
      endCursor: 12,
      truncated: false,
      text: "old output\n",
      dataBase64: Buffer.from("old output\n").toString("base64"),
    };
  }

  override async waitForTerminal(options: TerminalWaitOptions): Promise<JsonObject> {
    return { terminalId: options.terminalId, matched: true };
  }
}

let transportClient: InMemoryTransport;
let transportServer: InMemoryTransport;
let mcpClient: Client;
let mcpServer: ReturnType<typeof createMachinenMcpServer>;
let machinen: FakeMachinenClient;

beforeEach(async () => {
  machinen = new FakeMachinenClient();
  mcpServer = createMachinenMcpServer(machinen);
  [transportClient, transportServer] = InMemoryTransport.createLinkedPair();
  mcpClient = new Client({ name: "test", version: "1" });
  await Promise.all([mcpServer.connect(transportServer), mcpClient.connect(transportClient)]);
});

afterEach(async () => {
  await mcpClient.close();
  await mcpServer.close();
});

describe("Machinen MCP tools", () => {
  it("publishes the complete workspace, tile, terminal, and UI tool surface", async () => {
    const tools = await mcpClient.listTools();
    const names = tools.tools.map((tool) => tool.name);

    expect(names).toHaveLength(34);
    expect(names).toContain("machinen_get_state");
    expect(names).toContain("workspace_create");
    expect(names).toContain("tile_create");
    expect(names).toContain("terminal_wait");
    expect(names).toContain("status_set");
    expect(names).toContain("ui_focus");
  });

  it("forwards operations and adds an output cursor to terminal_send", async () => {
    const workspace = await mcpClient.callTool({
      name: "workspace_create",
      arguments: { name: "website", idempotencyKey: "workspace-website" },
    });
    expect(workspace.isError).not.toBe(true);
    expect(workspace.structuredContent).toEqual({ id: "ws_test", name: "website" });
    expect(machinen.requests.at(-1)).toEqual({
      operation: "workspace.create",
      params: { name: "website" },
      idempotencyKey: "workspace-website",
    });

    const sent = await mcpClient.callTool({
      name: "terminal_send",
      arguments: { terminalId: "term_test", text: "start", appendNewline: true },
    });
    expect(sent.isError).not.toBe(true);
    expect(sent.structuredContent).toEqual({
      terminalId: "term_test",
      bytesWritten: 6,
      outputCursor: 12,
    });

    const graph = await mcpClient.callTool({
      name: "status_set",
      arguments: {
        id: "network",
        kind: "sparkline",
        graphStyle: "mirrored",
        samples: [1, 4, 2],
        secondarySamples: [2, 1, 3],
      },
    });
    expect(graph.isError).not.toBe(true);
    expect(machinen.requests.at(-1)).toEqual({
      operation: "status.set",
      params: {
        id: "network",
        kind: "sparkline",
        graphStyle: "mirrored",
        samples: [1, 4, 2],
        secondarySamples: [2, 1, 3],
      },
    });
  });
});
