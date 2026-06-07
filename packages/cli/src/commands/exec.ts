import { attach, formatMachinenError, isMachinenError, type VmHandle } from "@machinen/runtime";

import { extractTarget, type Target } from "../parse-target.ts";

export async function cmdExec(args: string[]): Promise<number> {
  const parsed = parseExecArgs(args);
  const vm = await attach(parsed.target).catch(handleError);
  try {
    return await runExecCommand(vm, parsed);
  } finally {
    await vm.detach();
  }
}

interface ParsedExecArgs {
  target: Target;
  cmd: string;
  usePty: boolean;
}

function parseExecArgs(args: string[]): ParsedExecArgs {
  const { usePty, filtered } = consumeExecPtyFlag(args);
  const dashIdx = filtered.indexOf("--");
  if (dashIdx === -1 || dashIdx === filtered.length - 1) {
    die("usage: machinen exec <name|pid> [--tty] -- <cmd>");
  }
  return {
    usePty,
    target: parseTargetFlags(filtered.slice(0, dashIdx), "exec"),
    cmd: filtered.slice(dashIdx + 1).join(" "),
  };
}

function consumeExecPtyFlag(args: string[]): { usePty: boolean; filtered: string[] } {
  const filtered: string[] = [];
  let usePty = false;
  for (const arg of args) {
    if (arg === "--tty" || arg === "--pty") {
      usePty = true;
    } else {
      filtered.push(arg);
    }
  }
  return { usePty, filtered };
}

async function runExecCommand(vm: VmHandle, parsed: ParsedExecArgs): Promise<number> {
  if (parsed.usePty) {
    assertExecPtyTty();
    return runPtyExec(vm, parsed.cmd);
  }
  return runRawExec(vm, parsed.cmd);
}

function assertExecPtyTty(): void {
  if (!process.stdin.isTTY) {
    die("machinen exec --tty: stdin is not a TTY; pass via terminal or drop --tty");
  }
}

async function runRawExec(vm: VmHandle, cmd: string): Promise<number> {
  const res = await vm.execRaw(cmd, {
    onStdout: (chunk) => process.stdout.write(chunk),
    onStderr: (chunk) => process.stderr.write(chunk),
  });
  return res.exitCode;
}

async function runPtyExec(vm: VmHandle, cmd: string): Promise<number> {
  const tty = enterPtyRawMode();
  const handle = vm.execPty(cmd, {
    cols: tty.cols,
    rows: tty.rows,
    stdin: process.stdin,
    stdout: process.stdout,
  });
  const onResize = () =>
    handle.resize(process.stdout.columns ?? tty.cols, process.stdout.rows ?? tty.rows);
  process.stdout.on("resize", onResize);
  try {
    const { exitCode } = await handle.result;
    return exitCode;
  } finally {
    process.stdout.removeListener("resize", onResize);
    tty.restore();
  }
}

function enterPtyRawMode(): { cols: number; rows: number; restore: () => void } {
  const wasRaw = process.stdin.isRaw === true;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return {
    cols: process.stdout.columns ?? 80,
    rows: process.stdout.rows ?? 24,
    restore: () => restorePtyRawMode(wasRaw),
  };
}

function restorePtyRawMode(wasRaw: boolean): void {
  if (wasRaw) {
    return;
  }
  try {
    process.stdin.setRawMode(false);
  } catch {}
}

function parseTargetFlags(args: string[], cmd: string): Target {
  try {
    const { target, rest } = extractTarget(args, cmd);
    if (rest.length > 0) {
      die(`unknown argument: ${rest[0]}`);
    }
    return target;
  } catch (err) {
    handleError(err);
  }
}

function handleError(err: unknown): never {
  if (isMachinenError(err)) {
    process.stderr.write(`machinen: ${formatMachinenError(err)}\n`);
    process.exit(1);
  }
  throw err;
}

function die(msg: string): never {
  process.stderr.write(`machinen: ${msg}\n`);
  process.exit(1);
}
