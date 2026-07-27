import { execFile } from "node:child_process";

import type { WorkspaceLocation } from "@machinen/desktop-sdk";

type WorkspaceProbeScript = (directory: string) => string;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function remoteShellPath(path: string): string {
  if (path === "~") {
    return '"$HOME"';
  }
  if (path.startsWith("~/")) {
    return `"$HOME"/${shellQuote(path.slice(2))}`;
  }
  return shellQuote(path);
}

function execute(
  executable: string,
  args: string[],
  options: { environment?: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      {
        encoding: "utf8",
        env: options.environment,
        maxBuffer: 1024 * 1024,
        signal: options.signal,
      },
      (error, stdout) => {
        if (error) {
          reject(error);
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

export function runWorkspaceProbe(
  location: WorkspaceLocation,
  script: WorkspaceProbeScript,
  signal?: AbortSignal,
): Promise<string> {
  if (location.kind === "local") {
    const environment = { ...process.env, MACHINEN_STATUS_DIRECTORY: location.path };
    return execute("/bin/sh", ["-c", script('"$MACHINEN_STATUS_DIRECTORY"')], {
      environment,
      signal,
    });
  }
  return execute(
    "/usr/bin/ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=5",
      location.host,
      script(remoteShellPath(location.path)),
    ],
    { signal },
  );
}
