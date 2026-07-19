import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import { MachinenClient, type JsonObject } from "./machinen-client.js";

const workspaceId = z.string().min(1).describe("Opaque workspace ID from Machinen");
const tileId = z.string().min(1).describe("Opaque tile ID from Machinen");
const terminalId = z.string().min(1).describe("Opaque terminal ID from Machinen");
const position = z.number().int().min(0).optional().describe("Zero-based visual position");
const idempotencyKey = z.string().min(1).optional().describe("Optional retry key for this app run");

const launch = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("loginShell") }),
  z.object({
    kind: z.literal("shellCommand"),
    command: z.string().min(1).describe("Command interpreted by the user's login shell"),
  }),
  z.object({
    kind: z.literal("exec"),
    executable: z.string().min(1).describe("Absolute executable path"),
    arguments: z.array(z.string()).optional(),
    environment: z.record(z.string(), z.string()).optional(),
  }),
]);

function successfulResult(value: unknown) {
  const structuredContent: JsonObject =
    value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : { value };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent,
  };
}

function failedResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

async function invoke(
  client: MachinenClient,
  operation: string,
  params: JsonObject = {},
  retryKey?: string,
) {
  try {
    return successfulResult(await client.request(operation, params, retryKey));
  } catch (error) {
    return failedResult(error);
  }
}

export function registerMachinenTools(server: McpServer, client: MachinenClient): void {
  server.registerTool(
    "machinen_get_state",
    {
      description:
        "Get an atomic snapshot of Machinen's workspaces, tiles, terminals, and camera state. Call this first to discover IDs.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => invoke(client, "system.snapshot"),
  );

  server.registerTool(
    "workspace_list",
    {
      description: "List visual workspaces and their ordered tile IDs.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => invoke(client, "workspace.list"),
  );

  server.registerTool(
    "workspace_get",
    {
      description: "Get one workspace by ID.",
      inputSchema: { workspaceId },
      annotations: { readOnlyHint: true },
    },
    async (params) => invoke(client, "workspace.get", params),
  );

  server.registerTool(
    "workspace_create",
    {
      description: "Create an empty visual workspace. This does not create a terminal tile.",
      inputSchema: {
        name: z.string().min(1),
        position,
        idempotencyKey,
      },
    },
    async ({ idempotencyKey: retryKey, ...params }) =>
      invoke(client, "workspace.create", params, retryKey),
  );

  server.registerTool(
    "workspace_update",
    {
      description: "Rename a workspace while preserving its stable ID and tiles.",
      inputSchema: { workspaceId, name: z.string().min(1) },
    },
    async (params) => invoke(client, "workspace.update", params),
  );

  server.registerTool(
    "workspace_move",
    {
      description: "Move a workspace to another zero-based overview position.",
      inputSchema: { workspaceId, position: z.number().int().min(0) },
    },
    async (params) => invoke(client, "workspace.move", params),
  );

  server.registerTool(
    "workspace_stop",
    {
      description: "Stop every running terminal process in a workspace. Tile definitions remain.",
      inputSchema: { workspaceId },
      annotations: { destructiveHint: true },
    },
    async (params) => invoke(client, "workspace.stop", params),
  );

  server.registerTool(
    "workspace_restart",
    {
      description:
        "Restart stopped or exited terminals in a workspace from their saved launch definitions.",
      inputSchema: { workspaceId },
    },
    async (params) => invoke(client, "workspace.restart", params),
  );

  server.registerTool(
    "workspace_delete",
    {
      description:
        "Delete a workspace and its stopped tiles. Fails while any terminal is running and never deletes working-directory files.",
      inputSchema: { workspaceId },
      annotations: { destructiveHint: true },
    },
    async (params) => invoke(client, "workspace.delete", params),
  );

  server.registerTool(
    "tile_list",
    {
      description: "List terminal tiles, optionally restricted to a workspace.",
      inputSchema: { workspaceId: workspaceId.optional() },
      annotations: { readOnlyHint: true },
    },
    async (params) => invoke(client, "tile.list", params),
  );

  server.registerTool(
    "tile_get",
    {
      description: "Get one spatial tile and its terminal ID.",
      inputSchema: { tileId },
      annotations: { readOnlyHint: true },
    },
    async (params) => invoke(client, "tile.get", params),
  );

  server.registerTool(
    "tile_create",
    {
      description:
        "Atomically create a terminal tile and launch its persistent PTY. Use arbitrary shell commands rather than agent-specific launchers.",
      inputSchema: {
        workspaceId,
        kind: z.literal("terminal").default("terminal"),
        name: z.string().min(1).optional(),
        label: z.string().min(1).optional(),
        position,
        terminal: z.object({
          workingDirectory: z.string().min(1).optional(),
          launch: launch.optional(),
        }),
        focus: z.boolean().optional(),
        idempotencyKey,
      },
    },
    async ({ idempotencyKey: retryKey, ...params }) =>
      invoke(client, "tile.create", params, retryKey),
  );

  server.registerTool(
    "tile_update",
    {
      description: "Update a tile's display name, short label, or activity state.",
      inputSchema: {
        tileId,
        name: z.string().min(1).optional(),
        label: z.string().min(1).optional(),
        activityState: z.enum(["working", "waiting", "idle", "unknown"]).optional(),
      },
    },
    async (params) => invoke(client, "tile.update", params),
  );

  server.registerTool(
    "tile_move",
    {
      description:
        "Move a tile to a workspace and optional zero-based position without restarting its terminal.",
      inputSchema: { tileId, workspaceId, position },
    },
    async (params) => invoke(client, "tile.move", params),
  );

  server.registerTool(
    "tile_attach",
    {
      description: "Attach a visual viewer to a detached running terminal tile.",
      inputSchema: { tileId },
    },
    async (params) => invoke(client, "tile.attach", params),
  );

  server.registerTool(
    "tile_detach",
    {
      description: "Detach a tile viewer without stopping its persistent terminal process.",
      inputSchema: { tileId },
    },
    async (params) => invoke(client, "tile.detach", params),
  );

  server.registerTool(
    "tile_delete",
    {
      description: "Delete a stopped or exited terminal tile. Stop its terminal first.",
      inputSchema: { tileId },
      annotations: { destructiveHint: true },
    },
    async (params) => invoke(client, "tile.delete", params),
  );

  server.registerTool(
    "terminal_get",
    {
      description:
        "Get a terminal's launch definition, process state, activity state, and viewer state.",
      inputSchema: { terminalId },
      annotations: { readOnlyHint: true },
    },
    async (params) => invoke(client, "terminal.get", params),
  );

  server.registerTool(
    "terminal_send",
    {
      description:
        "Send UTF-8 text or base64 bytes to a persistent PTY, including while its tile viewer is detached.",
      inputSchema: {
        terminalId,
        text: z.string().optional(),
        dataBase64: z.string().optional(),
        appendNewline: z.boolean().optional(),
      },
    },
    async (params) => {
      const outputCursor = client.readTerminalOutput(params.terminalId).endCursor;
      try {
        const result = (await client.request("terminal.send", params)) as JsonObject;
        return successfulResult({ ...result, outputCursor });
      } catch (error) {
        return failedResult(error);
      }
    },
  );

  server.registerTool(
    "terminal_signal",
    {
      description: "Send interrupt, terminate, kill, or hangup to a terminal process.",
      inputSchema: {
        terminalId,
        signal: z.enum(["interrupt", "terminate", "kill", "hangup"]),
      },
      annotations: { destructiveHint: true },
    },
    async (params) => invoke(client, "terminal.signal", params),
  );

  server.registerTool(
    "terminal_stop",
    {
      description: "Stop a terminal process while preserving its tile and launch definition.",
      inputSchema: { terminalId },
      annotations: { destructiveHint: true },
    },
    async (params) => invoke(client, "terminal.stop", params),
  );

  server.registerTool(
    "terminal_restart",
    {
      description:
        "Restart a terminal from its saved launch definition, optionally focusing its tile.",
      inputSchema: { terminalId, focus: z.boolean().optional() },
    },
    async (params) => invoke(client, "terminal.restart", params),
  );

  server.registerTool(
    "terminal_output",
    {
      description:
        "Read output recently observed from an attached terminal viewer. Use the returned endCursor as afterCursor on the next call.",
      inputSchema: { terminalId, afterCursor: z.number().int().min(0).optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ terminalId, afterCursor }) =>
      successfulResult(client.readTerminalOutput(terminalId, afterCursor)),
  );

  server.registerTool(
    "terminal_wait",
    {
      description:
        "Wait until recent terminal output contains literal text, the process reaches a state, or both conditions hold.",
      inputSchema: {
        terminalId,
        contains: z.string().min(1).optional(),
        processState: z
          .enum(["starting", "running", "stopped", "exited", "disconnected"])
          .optional(),
        timeoutMilliseconds: z.number().int().min(1).max(300_000).optional(),
        afterCursor: z.number().int().min(0).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (params) => {
      try {
        return successfulResult(await client.waitForTerminal(params));
      } catch (error) {
        return failedResult(error);
      }
    },
  );

  server.registerTool(
    "ui_get",
    {
      description: "Get Machinen's current camera level and selected or focused tile IDs.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => invoke(client, "ui.get"),
  );

  server.registerTool(
    "ui_select",
    {
      description: "Select a workspace or tile without entering or focusing it.",
      inputSchema: {
        workspaceId: workspaceId.optional(),
        tileId: tileId.optional(),
      },
    },
    async (params) => invoke(client, "ui.select", params),
  );

  server.registerTool(
    "ui_focus",
    {
      description:
        "Move the camera into a tile and optionally attach it or bring Machinen to the foreground.",
      inputSchema: {
        tileId,
        attach: z.boolean().optional(),
        activateApplication: z.boolean().optional(),
      },
    },
    async (params) => invoke(client, "ui.focus", params),
  );

  server.registerTool(
    "ui_enter",
    {
      description: "Enter the currently selected workspace or tile.",
      inputSchema: {},
    },
    async () => invoke(client, "ui.enter"),
  );

  server.registerTool(
    "ui_zoom_out",
    {
      description:
        "Move the camera out by a number of levels or return all the way to the overview.",
      inputSchema: {
        levels: z.union([z.number().int().min(1), z.literal("all")]).default(1),
      },
    },
    async (params) => invoke(client, "ui.zoomOut", params),
  );

  server.registerTool(
    "ui_overview",
    {
      description: "Move the camera directly to the all-workspaces overview.",
      inputSchema: {},
    },
    async () => invoke(client, "ui.overview"),
  );

  server.registerTool(
    "ui_activate",
    {
      description: "Bring Machinen to the foreground without changing camera state.",
      inputSchema: {},
    },
    async () => invoke(client, "ui.activate"),
  );
}
