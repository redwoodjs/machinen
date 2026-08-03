// machinen CLI — boot a microVM and drive it (exec, snapshot, attach),
// plus pre-fetch the kernel + rootfs assets published alongside each
// release tag.
//
// Surface:
//   machinen boot [opts] -- <cmd>
//   machinen restore <snap-dir> [--name <name>] [-p <hostPort>:<guestPort>]
//   machinen ls (alias: ps)
//   machinen exec <name|pid> -- <cmd>
//   machinen snapshot <name|pid> <out-dir>
//   machinen attach <name|pid> [--shell <cmd>]   # PTY shell
//   machinen attach [--session <session>] [name|pid] # persistent PTY shell
//   machinen repl   <name|pid>                   # per-line exec
//   machinen run <target>                        # run a known CLI in a VM
//   machinen terminal <new|list|inspect|attach|take|resize|send|signal|stop|delete|reconcile|gc>
//   machinen completion <bash|zsh|fish>
//   machinen --version | -h | --help

import { formatMachinenError, isMachinenError } from "@machinen/runtime";
import debugLib from "debug";

import { VERSION } from "./base-assets.ts";
import { printHelp } from "./help.ts";
import { die } from "./errors.ts";
import { cmdAttach, cmdRepl, cmdSessionKill, cmdSessions } from "./commands/attach.ts";
import { cmdBoot } from "./commands/boot.ts";
import { cmdExec } from "./commands/exec.ts";
import { cmdFork } from "./commands/fork.ts";
import { cmdInstall } from "./commands/install.ts";
import { cmdAgentContext, cmdCompletion, cmdFeedback } from "./commands/misc.ts";
import { cmdGc, cmdLs } from "./commands/registry.ts";
import { cmdRestore } from "./commands/restore.ts";
import { cmdRun } from "./commands/run.ts";
import { cmdSnapshot } from "./commands/snapshot.ts";
import { cmdStop } from "./commands/stop.ts";
import { cmdTerminal } from "./commands/terminal.ts";

const debug = debugLib("machinen:cli");

// ------------------------------------------------------------
// Entry
// ------------------------------------------------------------

type CommandHandler = (args: string[]) => number | Promise<number>;

const COMMAND_HANDLERS = new Map<string, CommandHandler>([
  ["boot", cmdBoot],
  ["restore", cmdRestore],
  ["install", cmdInstall],
  ["list", cmdLs],
  ["ls", cmdLs],
  ["ps", cmdLs],
  ["exec", cmdExec],
  ["snapshot", cmdSnapshot],
  ["fork", cmdFork],
  ["attach", cmdAttach],
  ["sessions", cmdSessions],
  ["session-kill", cmdSessionKill],
  ["repl", cmdRepl],
  ["run", cmdRun],
  ["completion", cmdCompletion],
  ["gc", cmdGc],
  ["stop", cmdStop],
  ["terminal", cmdTerminal],
  ["feedback", cmdFeedback],
  ["agent-context", cmdAgentContext],
]);

async function main(): Promise<number> {
  const [sub, ...rest] = process.argv.slice(2);
  debug("dispatch sub=%s argc=%d", commandLabel(sub), rest.length);

  const topLevelCode = maybeHandleTopLevelCommand(sub);
  if (topLevelCode !== undefined) {
    return topLevelCode;
  }
  return dispatchSubcommand(sub!, rest);
}

function commandLabel(sub: string | undefined): string {
  if (sub === undefined) {
    return "<empty>";
  }
  return sub;
}

function maybeHandleTopLevelCommand(sub: string | undefined): number | undefined {
  const helpCode = maybePrintTopLevelHelp(sub);
  if (helpCode !== undefined) {
    return helpCode;
  }
  return maybePrintVersion(sub);
}

function dispatchSubcommand(sub: string, rest: string[]): number | Promise<number> {
  const handler = COMMAND_HANDLERS.get(sub);
  if (handler) {
    return handler(rest);
  }
  die(`unknown command: ${sub}\nRun 'machinen --help' for usage.`);
}

function maybePrintTopLevelHelp(sub: string | undefined): number | undefined {
  if (!sub) {
    printHelp();
    return 0;
  }
  if (sub === "-h") {
    printHelp();
    return 0;
  }
  if (sub === "--help") {
    printHelp();
    return 0;
  }
  return undefined;
}

function maybePrintVersion(sub: string | undefined): number | undefined {
  if (sub === "--version") {
    return printVersion();
  }
  if (sub === "-v") {
    return printVersion();
  }
  return undefined;
}

function printVersion(): number {
  process.stdout.write(`${VERSION}\n`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    if (isMachinenError(err)) {
      process.stderr.write(`machinen: ${formatMachinenError(err)}\n`);
      process.exit(1);
    }
    process.stderr.write(
      `machinen: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  },
);
