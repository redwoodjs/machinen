import { posix as path } from "node:path";

import type {
  ContextCommandDefinition,
  ContextCommandInvocation,
  DesktopEvent,
  JsonObject,
  MachinenDesktopClient,
} from "@machinen/desktop-sdk";

import { reportServiceError } from "../status-publisher.js";

const registrationTTLMilliseconds = 30_000;
const registrationRefreshMilliseconds = 20_000;
const executablePath = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin",
].join(":");

interface ContextCommand extends ContextCommandDefinition {
  run(context: ContextCommandInvocation, desktop: MachinenDesktopClient): Promise<void>;
}

type DirectoryTool = "glow" | "yazi";

function directoryCommand(
  id: string,
  title: string,
  context: ContextCommandDefinition["context"],
  tool: DirectoryTool,
): ContextCommand {
  return {
    id,
    title,
    subtitle: context === "workspace" ? "workspace" : "terminal · OSC 7 cwd",
    context,
    priority: context === "terminal" ? 110 : 100,
    async run(invocation, desktop) {
      const directory = invocation.workingDirectory;
      const arguments_ = tool === "glow" ? ["glow", "--tui", directory] : ["yazi", directory];
      await desktop.request("tile.create", {
        workspaceId: invocation.workspaceId,
        kind: "terminal",
        name: `${tool} ${path.basename(directory)}`,
        terminal: {
          workingDirectory: directory,
          launch: {
            kind: "exec",
            executable: "/usr/bin/env",
            arguments: arguments_,
            environment: {
              PATH: executablePath,
              TERM_PROGRAM: "ghostty",
            },
          },
        },
        focus: true,
      });
    },
  };
}

export const contextCommands: ContextCommand[] = [
  directoryCommand(
    "machinen.glow-terminal-directory",
    "Open terminal directory in Glow",
    "terminal",
    "glow",
  ),
  directoryCommand(
    "machinen.yazi-terminal-directory",
    "Open terminal directory in Yazi",
    "terminal",
    "yazi",
  ),
  directoryCommand("machinen.glow-workspace", "Open workspace in Glow", "workspace", "glow"),
  directoryCommand("machinen.yazi-workspace", "Open workspace in Yazi", "workspace", "yazi"),
];

export class ContextCommandsService {
  private refreshTimer?: NodeJS.Timeout;
  private started = false;

  constructor(private readonly desktop: MachinenDesktopClient) {}

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    void this.publish();
    this.refreshTimer = setInterval(() => void this.publish(), registrationRefreshMilliseconds);
  }

  stop(): void {
    this.started = false;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  handleEvent(event: DesktopEvent): void {
    if (event.event !== "command.invoked") {
      return;
    }
    const invocation = parseInvocation(event.data);
    if (!invocation) {
      reportServiceError("context-commands", new Error("received an invalid invocation"));
      return;
    }
    const command = contextCommands.find((candidate) => candidate.id === invocation.commandId);
    if (!command) {
      return;
    }
    void command.run(invocation, this.desktop).catch((error: unknown) => {
      reportServiceError(command.id, error);
      const message = error instanceof Error ? error.message : String(error);
      void this.desktop.status
        .set({
          id: "machinen.context-command-error",
          scope: { kind: "workspace", id: invocation.workspaceId },
          kind: "text",
          value: `${command.title} failed`,
          tone: "error",
          tooltip: message,
          priority: 1_000,
          ttlMilliseconds: 8_000,
        })
        .catch((statusError: unknown) => reportServiceError("context-commands", statusError));
    });
  }

  private async publish(): Promise<void> {
    try {
      await Promise.all(
        contextCommands.map(({ run: _run, ...command }) =>
          this.desktop.commands.set({
            ...command,
            ttlMilliseconds: registrationTTLMilliseconds,
          }),
        ),
      );
    } catch (error) {
      reportServiceError("context-commands", error);
    }
  }
}

function parseInvocation(data: JsonObject): ContextCommandInvocation | undefined {
  if (
    !allStrings([data.invocationId, data.commandId, data.workspaceId, data.workingDirectory]) ||
    !isCommandContext(data.context) ||
    !isWorkspaceLocation(data.location)
  ) {
    return undefined;
  }
  if (data.context === "terminal" && !allStrings([data.tileId, data.terminalId])) {
    return undefined;
  }
  return data as ContextCommandInvocation;
}

function allStrings(values: unknown[]): boolean {
  return values.every((value) => typeof value === "string");
}

function isCommandContext(value: unknown): boolean {
  return ["workspace", "terminal"].includes(String(value));
}

function isWorkspaceLocation(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const location = value as JsonObject;
  if (!allStrings([location.kind, location.path])) {
    return false;
  }
  if (!["local", "ssh"].includes(String(location.kind))) {
    return false;
  }
  return location.kind !== "ssh" || typeof location.host === "string";
}
