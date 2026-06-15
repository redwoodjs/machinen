import { attach, type RegistryEntry, type VmHandle } from "@machinen/runtime";
import { readFileSync } from "node:fs";

import { die, handleError } from "../errors.ts";
import type { Target } from "../parse-target.ts";
import { tailLines } from "../tail-lines.ts";
import { runPtyExec } from "./pty.ts";
import { describeTarget, lookupEntry, parseTargetFlags } from "./target.ts";

export async function cmdAttach(args: string[]): Promise<number> {
  const opts = parseAttachOptions(args);
  printAttachTailIfRequested(opts);
  // Resolve the target before the TTY check: a typo in --name should
  // surface "no running VM found", not the TTY error. The TTY error
  // is only useful once we know the VM exists.
  const vm = await attach(opts.target).catch(handleError);
  return runAttachedPty(vm, opts.shell, opts.sessionName);
}

interface AttachOptionsCli {
  shell: string;
  sessionName?: string;
  tail?: number | "all";
  target: Target;
}

function parseAttachOptions(args: string[]): AttachOptionsCli {
  const state = {
    shell: "/bin/bash -i",
    sessionName: undefined as string | undefined,
    tail: undefined as number | "all" | undefined,
    rest: [] as string[],
  };
  for (let i = 0; i < args.length; i++) {
    i = consumeAttachArg(args, i, state);
  }
  return {
    shell: state.shell,
    sessionName: state.sessionName,
    tail: state.tail,
    target: parseTargetFlags(state.rest, "attach"),
  };
}

type AttachArgState = {
  shell: string;
  sessionName?: string;
  tail?: number | "all";
  rest: string[];
};

type AttachArgHandler = (
  args: string[],
  index: number,
  arg: string,
  state: AttachArgState,
) => number;

function consumeAttachArg(args: string[], index: number, state: AttachArgState): number {
  const arg = args[index]!;
  const handler = attachArgHandler(arg);
  if (handler) {
    return handler(args, index, arg, state);
  }
  state.rest.push(arg);
  return index;
}

const ATTACH_ARG_HANDLERS: Array<[(arg: string) => boolean, AttachArgHandler]> = [
  [(arg) => arg === "--shell" || arg.startsWith("--shell="), consumeAttachShell],
  [(arg) => arg === "--session" || arg.startsWith("--session="), consumeAttachSession],
  [(arg) => arg === "--tail" || arg.startsWith("--tail="), consumeAttachTail],
];

function attachArgHandler(arg: string): AttachArgHandler | undefined {
  return ATTACH_ARG_HANDLERS.find(([matches]) => matches(arg))?.[1];
}

function consumeAttachShell(
  args: string[],
  index: number,
  arg: string,
  state: { shell: string },
): number {
  const value = arg === "--shell" ? args[index + 1] : arg.slice("--shell=".length);
  if (!value) {
    die("--shell requires a value");
  }
  state.shell = value;
  return arg === "--shell" ? index + 1 : index;
}

function consumeAttachSession(
  args: string[],
  index: number,
  arg: string,
  state: { sessionName?: string },
): number {
  const value = arg === "--session" ? args[index + 1] : arg.slice("--session=".length);
  if (!value) {
    die("--session requires a value");
  }
  validateSessionName(value);
  state.sessionName = value;
  return arg === "--session" ? index + 1 : index;
}

function validateSessionName(value: string): void {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(value)) {
    die("--session must be 1-64 characters using only letters, digits, dot, underscore, or dash");
  }
}

function consumeAttachTail(
  args: string[],
  index: number,
  arg: string,
  state: { tail?: number | "all" },
): number {
  const { value, nextIndex } = attachTailValue(args, index, arg);
  state.tail = parseAttachTail(value);
  return nextIndex;
}

function attachTailValue(
  args: string[],
  index: number,
  arg: string,
): { value: string | undefined; nextIndex: number } {
  if (arg !== "--tail") {
    return { value: arg.slice("--tail=".length), nextIndex: index };
  }
  const peek = args[index + 1];
  if (peek && /^[0-9]+$/.test(peek)) {
    return { value: peek, nextIndex: index + 1 };
  }
  return { value: undefined, nextIndex: index };
}

function parseAttachTail(value: string | undefined): number | "all" {
  // `--tail` (no value) prints the whole snapshot. `--tail N`
  // prints the last N lines. The snapshot is capped at ~1 MiB so
  // even the no-value form is bounded.
  if (value === undefined) {
    return "all";
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    die(`--tail: expected a non-negative integer, got '${value}'`);
  }
  return n;
}

function printAttachTailIfRequested(opts: AttachOptionsCli): void {
  // #150 phase 2 PR3: --tail dumps the boot-console snapshot before
  // (or instead of) the interactive shell. Look up the registry entry
  // directly — `attach()` only returns a VmHandle, not the registry row.
  if (opts.tail === undefined) {
    return;
  }
  const entry = lookupAttachTailEntry(opts.target);
  printBootLogTail(entry.bootLogPath!, opts.tail);
}

function lookupAttachTailEntry(target: Target): RegistryEntry {
  const entry = lookupEntry(target);
  if (!entry) {
    die(`machinen attach: no running VM matched ${describeTarget(target)}`);
  }
  if (!entry.bootLogPath) {
    die(
      `machinen attach --tail: VM was not booted with --detached, no snapshot exists. ` +
        `Use 'machinen attach' (no --tail) for live console access.`,
    );
  }
  return entry;
}

async function runAttachedPty(
  vm: VmHandle,
  shell: string,
  sessionName: string | undefined,
): Promise<number> {
  if (!process.stdin.isTTY) {
    await vm.detach();
    die("machinen attach: stdin is not a TTY (pipe scripts via `machinen repl` instead)");
  }
  const label = vm.name ?? `pid ${vm.pid}`;
  if (sessionName) {
    process.stderr.write(
      `attached to ${label} session ${sessionName} — kill with machinen session-kill ${label} ${sessionName}.\n`,
    );
  } else {
    process.stderr.write(`attached to ${label} — exit the shell to detach.\n`);
  }
  try {
    return await runPtyExec(vm, shell, sessionName);
  } finally {
    await vm.detach();
  }
}

function printBootLogTail(path: string, tail: number | "all"): void {
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (err) {
    process.stderr.write(
      `machinen attach --tail: couldn't read ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }
  process.stderr.write(tailLines(content, tail));
}

export async function cmdSessions(args: string[]): Promise<number> {
  const target = parseTargetFlags(args, "sessions");
  const vm = await attach(target).catch(handleError);
  try {
    const sessions = await listPersistentSessions(vm);
    for (const session of sessions) {
      process.stdout.write(`${session.name}\t${session.pid}\n`);
    }
    return 0;
  } finally {
    await vm.detach();
  }
}

export async function cmdSessionKill(args: string[]): Promise<number> {
  const opts = parseSessionKillOptions(args);
  const vm = await attach(opts.target).catch(handleError);
  try {
    return opts.dryRun ? dryRunSessionKill(vm, opts.name) : killSessionOrDie(vm, opts.name);
  } finally {
    await vm.detach();
  }
}

function parseSessionKillOptions(args: string[]): {
  dryRun: boolean;
  name: string;
  target: Target;
} {
  const dryRun = args.includes("--dry-run");
  const positional = args.filter((arg) => arg !== "--dry-run");
  const name = positional.at(-1);
  if (!name) {
    die("machinen session-kill: missing session name");
  }
  validateSessionName(name);
  return {
    dryRun,
    name,
    target: parseTargetFlags(positional.slice(0, -1), "session-kill"),
  };
}

async function dryRunSessionKill(vm: VmHandle, name: string): Promise<number> {
  const sessions = await listPersistentSessions(vm);
  const exists = sessions.some((session) => session.name === name);
  process.stdout.write(
    exists ? `would kill persistent session ${name}\n` : `no persistent session named ${name}\n`,
  );
  return exists ? 0 : 1;
}

async function killSessionOrDie(vm: VmHandle, name: string): Promise<number> {
  const killed = await killPersistentSession(vm, name);
  if (!killed) {
    die(`machinen session-kill: no persistent session named ${name}`);
  }
  return 0;
}

async function listPersistentSessions(vm: VmHandle) {
  if (!vm.listSessions) {
    die("machinen sessions: this VM handle does not support persistent sessions");
  }
  return vm.listSessions();
}

async function killPersistentSession(vm: VmHandle, name: string) {
  if (!vm.killSession) {
    die("machinen session-kill: this VM handle does not support persistent sessions");
  }
  return vm.killSession(name);
}

export async function cmdRepl(args: string[]): Promise<number> {
  // Per-line exec REPL — every line you type is a fresh one-shot
  // command, so `cd`, env vars, and shell history do NOT carry over.
  // This is the niche `attach` used to fill; kept around for piping
  // a script of one-liners (e.g. `cat cmds.txt | machinen repl ...`).
  // For an actual interactive shell, use `machinen attach`.
  const target = parseTargetFlags(args, "repl");
  const vm = await attach(target).catch(handleError);
  printReplIntro(vm);
  try {
    await runReplLoop(vm);
    return 0;
  } finally {
    await vm.detach();
  }
}

function printReplIntro(vm: VmHandle): void {
  process.stderr.write(`repl: ${vm.name ?? `pid ${vm.pid}`}\n`);
  process.stderr.write(
    `each line is a fresh one-shot exec — cd / env vars / history do NOT persist.\n` +
      `for an interactive shell with job control + TUI support, use:\n` +
      `  machinen attach ${vm.name ?? vm.pid}\n` +
      `Ctrl-D to exit.\n`,
  );
}

async function runReplLoop(vm: VmHandle): Promise<void> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  for await (const line of rl) {
    await runReplLine(vm, line);
  }
}

async function runReplLine(vm: VmHandle, line: string): Promise<void> {
  if (line.length === 0) {
    return;
  }
  await vm.execRaw(line, {
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });
}
