import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { posix as path } from "node:path";

import type {
  SelectionOpenerDefinition,
  SelectionOpenerInvocation,
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

interface SelectionOpener extends SelectionOpenerDefinition {
  open(context: SelectionOpenerInvocation, desktop: MachinenDesktopClient): Promise<void>;
}

/**
 * User-editable destinations for the terminal's Open Selection With menu.
 * Native Machinen renders this metadata; TypeScript validates and opens the
 * selected text.
 */
export const selectionOpeners: SelectionOpener[] = [
  {
    id: "machinen.open-markdown-in-glow",
    title: "Glow",
    priority: 100,
    async open(context, desktop) {
      const markdownPaths = markdownPathsFromSelection(context.selection);
      const launchPath =
        context.location.kind === "local"
          ? firstExistingLocalMarkdownPath(
              markdownPaths,
              context.workingDirectory,
              context.location.path,
            )
          : markdownPaths[0];
      if (!launchPath) {
        throw new Error("the selection does not contain a valid Markdown file");
      }
      await desktop.request("tile.create", {
        workspaceId: context.workspaceId,
        kind: "terminal",
        name: `glow ${path.basename(launchPath)}`,
        terminal: {
          workingDirectory: context.workingDirectory,
          launch: {
            kind: "exec",
            executable: "/usr/bin/env",
            arguments: ["glow", "--pager", launchPath],
            environment: { PATH: executablePath },
          },
        },
        focus: true,
      });
    },
  },
  {
    id: "machinen.open-selection-in-yazi",
    title: "Yazi",
    priority: 95,
    async open(context, desktop) {
      const candidates = pathsFromSelection(context.selection);
      let launchPath: string | undefined;
      if (context.location.kind === "local") {
        launchPath = await firstExistingWorkspacePath(
          candidates,
          context.location.path,
          async (candidate) => existsSync(candidate),
        );
      } else {
        const { host, path: workspacePath } = context.location;
        launchPath = await firstExistingWorkspacePath(candidates, workspacePath, (candidate) =>
          remotePathExists(host, candidate),
        );
      }
      if (!launchPath) {
        throw new Error("the selection does not resolve against the workspace");
      }
      await desktop.request("tile.create", {
        workspaceId: context.workspaceId,
        kind: "terminal",
        name: `yazi ${path.basename(launchPath)}`,
        terminal: {
          workingDirectory: context.location.path,
          launch: {
            kind: "exec",
            executable: "/usr/bin/env",
            arguments: ["yazi", launchPath],
            environment: {
              PATH: executablePath,
              TERM_PROGRAM: "ghostty",
            },
          },
        },
        focus: true,
      });
    },
  },
  {
    id: "machinen.reveal-selection-in-finder",
    title: "Finder",
    locationKinds: ["local"],
    priority: 90,
    async open(context) {
      if (context.location.kind !== "local") {
        throw new Error("Finder can only reveal paths from a local workspace");
      }
      const launchPath = firstExistingLocalPath(
        pathsFromSelection(context.selection),
        context.location.path,
        context.location.path,
      );
      if (!launchPath) {
        throw new Error("the selection does not resolve against the local workspace");
      }
      const arguments_ = statSync(launchPath).isDirectory() ? [launchPath] : ["-R", launchPath];
      await runDetached("/usr/bin/open", arguments_);
    },
  },
];

export function markdownPathsFromSelection(selection: string): string[] {
  const candidates: string[] = [];
  const add = (raw: string | undefined): void => {
    if (!raw) {
      return;
    }
    const withoutLocation = raw.trim().replace(/:\d+(?::\d+)?$/, "");
    let decoded = withoutLocation;
    try {
      decoded = decodeURIComponent(withoutLocation);
    } catch {
      // Keep malformed percent escapes as written; existence validation will reject them.
    }
    if (!candidates.includes(decoded)) {
      candidates.push(decoded);
    }
  };
  const patterns = [
    /!?\[[^\]\r\n]*\]\(\s*<([^>\r\n]*\.(?:markdown|md)(?::\d+(?::\d+)?)?)(?:#[^>\r\n]*)?>/gi,
    /!?\[[^\]\r\n]*\]\(\s*([^\s)\r\n]*\.(?:markdown|md)(?::\d+(?::\d+)?)?)(?:#[^\s)\r\n]*)?/gi,
    /<([^<>\r\n]*\.(?:markdown|md)(?::\d+(?::\d+)?)?)(?:#[^<>\r\n]*)?>/gi,
    /[`'"]([^`'"\r\n]*\.(?:markdown|md)(?::\d+(?::\d+)?)?)[`'"]/gi,
    /((?:\/|~\/|\.\.?\/)?(?:[^\s`'"()<>[\]]+\/)*[^\s`'"()<>[\]]+\.(?:markdown|md)(?::\d+(?::\d+)?)?)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of selection.matchAll(pattern)) {
      add(match[1]);
    }
  }
  return candidates;
}

export function markdownPathFromSelection(selection: string): string | undefined {
  return markdownPathsFromSelection(selection)[0];
}

export function pathsFromSelection(selection: string): string[] {
  const candidates = [...markdownPathsFromSelection(selection)];
  const add = (raw: string | undefined): void => {
    if (!raw) {
      return;
    }
    const candidate = raw
      .trim()
      .replace(/^[`'"<([{]+/, "")
      .replace(/[`'">)\]},.;:]+$/, "");
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate);
    }
  };
  for (const pattern of [
    /!?\[[^\]\r\n]*\]\(\s*<([^>\r\n]+)>/g,
    /!?\[[^\]\r\n]*\]\(\s*([^\s)\r\n]+)/g,
    /((?:~\/|\/|\.\.?\/)[^\s`'"()<>[\]]+)/g,
  ]) {
    for (const match of selection.matchAll(pattern)) {
      add(match[1]);
    }
  }
  add(selection);
  return candidates;
}

export async function firstExistingWorkspacePath(
  candidates: string[],
  workspacePath: string,
  exists: (candidate: string) => Promise<boolean>,
): Promise<string | undefined> {
  for (const candidate of candidates) {
    for (const absolute of workspacePathCandidates(candidate, workspacePath)) {
      if (await exists(absolute)) {
        return absolute;
      }
    }
  }
  return undefined;
}

export function firstExistingLocalMarkdownPath(
  markdownPaths: string[],
  workingDirectory: string,
  workspacePath: string,
  exists: (candidate: string) => boolean = existsSync,
): string | undefined {
  return firstExistingLocalPath(markdownPaths, workingDirectory, workspacePath, exists);
}

export function firstExistingLocalPath(
  candidates: string[],
  workingDirectory: string,
  workspacePath: string,
  exists: (candidate: string) => boolean = existsSync,
): string | undefined {
  for (const candidate of candidates) {
    const localized = localizePath(candidate, workspacePath, exists);
    const expanded = localized.startsWith("~/")
      ? path.join(homedir(), localized.slice(2))
      : localized;
    const absolute = path.isAbsolute(expanded)
      ? expanded
      : path.resolve(workingDirectory, expanded);
    if (exists(absolute)) {
      return absolute;
    }
  }
  return undefined;
}

export function localizeMarkdownPath(
  markdownPath: string,
  workspacePath: string,
  exists: (candidate: string) => boolean = existsSync,
): string {
  return localizePath(markdownPath, workspacePath, exists);
}

function localizePath(
  candidatePath: string,
  workspacePath: string,
  exists: (candidate: string) => boolean,
): string {
  if (!path.isAbsolute(candidatePath) || exists(candidatePath)) {
    return candidatePath;
  }
  const workspaceName = path.basename(workspacePath);
  const marker = `/${workspaceName}/`;
  const markerIndex = candidatePath.lastIndexOf(marker);
  if (markerIndex < 0) {
    return candidatePath;
  }
  const candidate = path.join(workspacePath, candidatePath.slice(markerIndex + marker.length));
  return exists(candidate) ? candidate : candidatePath;
}

// Candidate construction intentionally covers relative, home, and cross-machine absolute paths.
// fallow-ignore-next-line complexity
function workspacePathCandidates(candidate: string, workspacePath: string): string[] {
  let decoded = candidate;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    // Keep malformed percent escapes as written; validation will reject them.
  }
  const homeMatch = /^\/(?:Users|home)\/[^/]+/.exec(workspacePath);
  const expanded =
    decoded.startsWith("~/") && homeMatch ? path.join(homeMatch[0], decoded.slice(2)) : decoded;
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(workspacePath, expanded);
  const results = [absolute];
  if (!path.isAbsolute(expanded)) {
    const workspaceName = path.basename(workspacePath);
    const normalized = expanded.replace(/^\.\//, "");
    if (normalized === workspaceName || normalized.startsWith(`${workspaceName}/`)) {
      const workspaceRelative = normalized.slice(workspaceName.length).replace(/^\//, "");
      const prefixed = path.resolve(workspacePath, workspaceRelative);
      if (!results.includes(prefixed)) {
        results.push(prefixed);
      }
    }
  }
  if (path.isAbsolute(expanded)) {
    const workspaceName = path.basename(workspacePath);
    const marker = `/${workspaceName}/`;
    const markerIndex = expanded.lastIndexOf(marker);
    if (markerIndex >= 0) {
      const localized = path.join(workspacePath, expanded.slice(markerIndex + marker.length));
      if (!results.includes(localized)) {
        results.push(localized);
      }
    }
  }
  return results;
}

async function remotePathExists(host: string, candidate: string): Promise<boolean> {
  return await new Promise<boolean>((resolve, reject) => {
    const quoted = `'${candidate.replaceAll("'", `'"'"'`)}'`;
    const child = spawn(
      "/usr/bin/ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=5", host, `[ -e ${quoted} ]`],
      { stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("close", (code) => resolve(code === 0));
  });
}

async function runDetached(executable: string, arguments_: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, arguments_, { detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export class SelectionOpenersService {
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
    if (event.event !== "selectionOpener.invoked") {
      return;
    }
    const invocation = parseInvocation(event.data);
    if (!invocation) {
      reportServiceError("selection-openers", new Error("received an invalid invocation"));
      return;
    }
    const opener = selectionOpeners.find((candidate) => candidate.id === invocation.openerId);
    if (!opener) {
      return;
    }
    void opener.open(invocation, this.desktop).catch((error: unknown) => {
      reportServiceError(opener.id, error);
      const message = error instanceof Error ? error.message : String(error);
      void this.desktop.status
        .set({
          id: "machinen.selection-opener-error",
          scope: { kind: "workspace", id: invocation.workspaceId },
          kind: "text",
          value: `${opener.title} failed`,
          tone: "error",
          tooltip: message,
          priority: 1_000,
          ttlMilliseconds: 8_000,
        })
        .catch((statusError: unknown) => reportServiceError("selection-openers", statusError));
    });
  }

  private async publish(): Promise<void> {
    try {
      await Promise.all(
        selectionOpeners.map(({ open: _open, ...opener }) =>
          this.desktop.selectionOpeners.set({
            ...opener,
            ttlMilliseconds: registrationTTLMilliseconds,
          }),
        ),
      );
    } catch (error) {
      reportServiceError("selection-openers", error);
    }
  }
}

// Runtime event payloads enter through JSON, so every required field is checked here.
// fallow-ignore-next-line complexity
function parseInvocation(data: JsonObject): SelectionOpenerInvocation | undefined {
  const location = data.location as JsonObject | undefined;
  if (
    typeof data.invocationId !== "string" ||
    typeof data.openerId !== "string" ||
    typeof data.selection !== "string" ||
    typeof data.workspaceId !== "string" ||
    typeof data.tileId !== "string" ||
    typeof data.terminalId !== "string" ||
    typeof data.workingDirectory !== "string" ||
    !location ||
    (location.kind !== "local" && location.kind !== "ssh") ||
    typeof location.path !== "string"
  ) {
    return undefined;
  }
  if (location.kind === "ssh" && typeof location.host !== "string") {
    return undefined;
  }
  return data as SelectionOpenerInvocation;
}
