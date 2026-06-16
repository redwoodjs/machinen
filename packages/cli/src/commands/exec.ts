import { attach, type VmHandle } from "@machinen/runtime";

import { die, handleError } from "../errors.ts";
import type { Target } from "../parse-target.ts";
import { runPtyExec } from "./pty.ts";
import { parseTargetFlags } from "./target.ts";

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
    return runPtyExec(vm, parsed.cmd, false);
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
