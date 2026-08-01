import { randomUUID } from "node:crypto";
import { accessSync, chmodSync, constants, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

import { die } from "../errors.ts";

const require = createRequire(import.meta.url);
const OPERATIONS = new Set([
  "new",
  "list",
  "inspect",
  "attach",
  "take",
  "resize",
  "send",
  "signal",
  "stop",
  "delete",
  "reconcile",
  "gc",
]);

export async function cmdTerminal(args: string[]): Promise<number> {
  const request = terminalRequest(args);
  if (request === undefined) {
    printTerminalHelp();
    return 0;
  }
  const parsed = consumeDatabase(request.args);
  const database = parsed.database ?? defaultSessionDatabasePath();
  prepareDatabaseDirectory(database);
  const helper = resolveSessionHelper();
  const invocation = nativeInvocation(request.operation, parsed.rest);
  const result = spawnSync(
    helper,
    [request.operation, "--database", database, ...invocation.args],
    {
      stdio: invocation.input === undefined ? "inherit" : ["pipe", "inherit", "inherit"],
      input: invocation.input,
    },
  );
  return sessionProcessExitCode(helper, result);
}

interface TerminalRequest {
  operation: string;
  args: string[];
}

function terminalRequest(args: string[]): TerminalRequest | undefined {
  const [operation, ...operationArgs] = args;
  if (!operation || ["help", "--help", "-h"].includes(operation)) {
    return undefined;
  }
  if (!OPERATIONS.has(operation)) {
    die(`unknown terminal operation: ${operation}\nRun 'machinen terminal --help' for usage.`);
  }
  return { operation, args: operationArgs };
}

function prepareDatabaseDirectory(database: string): void {
  mkdirSync(dirname(database), { recursive: true, mode: 0o700 });
  chmodSync(dirname(database), 0o700);
}

function sessionProcessExitCode(helper: string, result: ReturnType<typeof spawnSync>): number {
  if (result.error) {
    die(`could not run ${helper}: ${result.error.message}`);
  }
  if (result.signal === "SIGINT") {
    return 130;
  }
  if (result.signal === "SIGTERM") {
    return 143;
  }
  if (result.signal) {
    return 1;
  }
  return result.status ?? 1;
}

interface DatabaseArgs {
  database?: string;
  rest: string[];
}

export function consumeDatabase(args: string[]): DatabaseArgs {
  const rest: string[] = [];
  let database: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") {
      rest.push(...args.slice(index));
      break;
    }
    if (argument === "--database") {
      const value = args[index + 1];
      if (!value) {
        die("--database requires a path");
      }
      database = value;
      index += 1;
    } else if (argument.startsWith("--database=")) {
      database = argument.slice("--database=".length);
      if (!database) {
        die("--database requires a path");
      }
    } else {
      rest.push(argument);
    }
  }
  return { database, rest };
}

interface NativeInvocation {
  args: string[];
  input?: string;
}

export function nativeInvocation(operation: string, args: string[]): NativeInvocation {
  if (operation === "new") {
    return { args: newSessionArgs(args) };
  }
  if (operation === "send") {
    return sendInvocation(args);
  }
  return { args };
}

function newSessionArgs(args: string[]): string[] {
  const delimiter = args.indexOf("--");
  const options = delimiter < 0 ? [...args] : args.slice(0, delimiter);
  const command = delimiter < 0 ? [] : args.slice(delimiter + 1);
  if (!hasOption(options, "--id")) {
    options.push("--id", `term_${randomUUID()}`);
  }
  if (!hasOption(options, "--cwd")) {
    options.push("--cwd", process.cwd());
  }
  const selectedCommand = command.length > 0 ? command : [process.env.SHELL || "/bin/sh", "-l"];
  return [...options, "--", ...selectedCommand];
}

function sendInvocation(args: string[]): NativeInvocation {
  let appendNewline = false;
  const positional: string[] = [];
  for (const argument of args) {
    if (argument === "--newline") {
      appendNewline = true;
    } else {
      positional.push(argument);
    }
  }
  if (positional.length === 0) {
    die("usage: machinen terminal send <id-or-name> [--newline] [text]");
  }
  const [target, ...text] = positional;
  if (text.length === 0) {
    return { args: [target!] };
  }
  return {
    args: [target!],
    input: `${text.join(" ")}${appendNewline ? "\n" : ""}`,
  };
}

function hasOption(args: string[], option: string): boolean {
  return args.some((argument) => argument === option || argument.startsWith(`${option}=`));
}

export function defaultSessionDatabasePath(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  if (environment.MACHINEN_SESSION_DATABASE) {
    return resolve(environment.MACHINEN_SESSION_DATABASE);
  }
  if (platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Machinen", "sessions.sqlite3");
  }
  const stateRoot = environment.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(stateRoot, "machinen", "sessions.sqlite3");
}

function resolveSessionHelper(): string {
  const override = process.env.MACHINEN_SESSION_HELPER;
  if (override) {
    assertExecutable(override);
    return override;
  }
  for (const candidate of sessionHelperCandidates()) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  // Let spawn resolve an explicitly installed helper through PATH.
  return "machinen-session";
}

function sessionHelperCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, "../../../session/zig-out/bin/machinen-session"),
    resolve(here, "../../session/zig-out/bin/machinen-session"),
    resolve(process.cwd(), "packages/session/zig-out/bin/machinen-session"),
    join(homedir(), ".local", "bin", "machinen-session"),
  ];
  const nativePackage = nativePackageName();
  if (nativePackage) {
    try {
      candidates.unshift(
        join(dirname(require.resolve(nativePackage)), "vmm", "bin", "machinen-session"),
      );
    } catch {
      // The platform package is optional; source checkouts use zig-out.
    }
  }
  return candidates;
}

function nativePackageName(): string | undefined {
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "@machinen/native-arm64-darwin";
  }
  if (process.platform === "linux" && process.arch === "arm64") {
    return "@machinen/native-arm64-linux";
  }
  if (process.platform === "linux" && process.arch === "x64") {
    return "@machinen/native-x64-linux";
  }
  return undefined;
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function assertExecutable(path: string): void {
  if (!isExecutable(path)) {
    die(`MACHINEN_SESSION_HELPER=${path} is not executable`);
  }
}

function printTerminalHelp(): void {
  process.stdout.write(
    `Machinen host terminal sessions\n\nUsage:\n  machinen terminal new [--id <id>] [--name <name>] [--cwd <path>] -- [command...]\n  machinen terminal list\n  machinen terminal inspect <id-or-name>\n  machinen terminal attach [--after <sequence>] [--read-only] [--latest-screen] [--geometry-events] [--client-id <number>] [--client-name <name>] <id-or-name>\n  machinen terminal take --client-id <number> <id-or-name>\n  machinen terminal resize --columns <n> --rows <n> <id-or-name>\n  machinen terminal send <id-or-name> [--newline] [text]\n  machinen terminal signal <id-or-name> <interrupt|hangup|terminate|kill>\n  machinen terminal stop <id-or-name>\n  machinen terminal delete <id-or-name>\n  machinen terminal reconcile\n  machinen terminal gc [--older-than <seconds>] [--dry-run]\n\nOptions:\n  --database <path>   Override the platform-default session database.\n\nReattach using either the stable ID or unique name printed by 'terminal list'.\n`,
  );
}
