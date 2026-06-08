import type { MoveDescriptor, NativeProcessImageRefusal, VmHandle } from "@machinen/runtime";

import { parseGuestMoveResourceScan } from "./move-resource-plan.ts";

export interface MoveLoadDirectLoader {
  state: "ready" | "refused";
  strategy:
    | "target-original-ping-direct-loader"
    | "target-original-sleep-remaining-loader"
    | "target-original-tail-offset-loader"
    | "target-original-less-script-pty-loader"
    | "target-original-vi-readonly-script-pty-loader";
  executable: string;
  argv: string[];
  targetPid?: number;
  logPath?: string;
  capture?: unknown;
  patch?: { state: "ready" | "refused"; stdout: string; stderr: string; exitCode: number };
  refusals: NativeProcessImageRefusal[];
}

type MoveLoadRendezvous = MoveLoadDirectLoader;
type MoveCapture = NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>;
type MoveTailState = NonNullable<MoveCapture["tailState"]>;
type MoveLessState = NonNullable<MoveCapture["lessState"]>;
type MoveViState = NonNullable<MoveCapture["viState"]>;

export async function runMoveTargetDirectLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  if (descriptor.resourcePlan?.capture?.sleepState) {
    return runMoveTargetSleepLoaderInVm(vm, descriptor);
  }
  if (descriptor.resourcePlan?.capture?.tailState) {
    return runMoveTargetTailLoaderInVm(vm, descriptor);
  }
  if (descriptor.resourcePlan?.capture?.lessState) {
    return runMoveTargetLessLoaderInVm(vm, descriptor);
  }
  if (descriptor.resourcePlan?.capture?.viState) {
    return runMoveTargetViLoaderInVm(vm, descriptor);
  }
  const executable = moveRendezvousExecutable(descriptor);
  const argv = moveRendezvousArgv(descriptor, executable);
  const command = moveRendezvousCommand(executable, argv.slice(1), descriptor);
  const result = await vm.execRaw(command, { execTimeoutMs: 30_000 });
  const parsed = parseRendezvousOutput(result.stdout);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return loaderRefused(executable, argv, parsed, {
      code: "target-process-context-unsupported",
      message: "target ping direct loader failed before a capture was produced",
      detail: { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout },
    });
  }
  const capture = parseGuestMoveResourceScan(parsed.captureRows.join("\n"));
  const patch = moveRendezvousPatchFromOutput(result);
  const refusals = [...moveRendezvousRefusals(capture), ...movePatchRefusals(patch)];
  if (refusals.length > 0 && parsed.pid) {
    await vm.execRaw(`kill -TERM ${parsed.pid} 2>/dev/null || true`, { execTimeoutMs: 5_000 });
  }
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-ping-direct-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    capture,
    patch,
    refusals,
  };
}

async function runMoveTargetSleepLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const sleepState = descriptor.resourcePlan?.capture?.sleepState;
  const argv = [executable, sleepRemainingSecondsArg(sleepState?.remainingMs ?? 0)];
  const result = await vm.execRaw(moveSleepLoaderCommand(executable, argv[1]!), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveSleepPatchFromOutput(result);
  const refusals = moveSleepLoaderRefusals(patch);
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-sleep-remaining-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}

async function runMoveTargetTailLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const tailState = descriptor.resourcePlan?.capture?.tailState;
  const argv = [executable, "-c", `+${(tailState?.offset ?? 0) + 1}`, "-f", tailState?.path ?? ""];
  const result = await vm.execRaw(moveTailLoaderCommand(executable, tailState), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveTailPatchFromOutput(result);
  const refusals = moveTailLoaderRefusals(patch);
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-tail-offset-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}

async function runMoveTargetLessLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const lessState = descriptor.resourcePlan?.capture?.lessState;
  const argv = [executable, `+${lessState?.line ?? 1}`, lessState?.path ?? ""];
  const result = await vm.execRaw(moveScriptPtyLoaderCommand(executable, "less", lessState), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveScriptPtyPatchFromOutput(result, "less");
  const refusals = moveScriptPtyLoaderRefusals(patch, "target less script-pty loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-less-script-pty-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}

async function runMoveTargetViLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const viState = descriptor.resourcePlan?.capture?.viState;
  const argv = [executable, `+${viState?.line ?? 1}`, viState?.path ?? ""];
  const result = await vm.execRaw(moveScriptPtyLoaderCommand(executable, "vi", viState), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveScriptPtyPatchFromOutput(result, "vi");
  const refusals = moveScriptPtyLoaderRefusals(patch, "target vi script-pty loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-vi-readonly-script-pty-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}

function moveRendezvousExecutable(descriptor: MoveDescriptor): string {
  return (
    descriptor.resourcePlan?.capture?.executablePackage?.path ??
    descriptor.nodes[0]?.exe ??
    "/usr/bin/ping"
  );
}

function moveRendezvousArgv(descriptor: MoveDescriptor, executable: string): string[] {
  const argv = descriptor.nodes[0]?.argv ?? [];
  if (argv.length === 0) {
    return [executable];
  }
  return [executable, ...argv.slice(1)];
}

function moveRendezvousCommand(
  executable: string,
  args: string[],
  descriptor: MoveDescriptor,
): string {
  const pingState = descriptor.resourcePlan?.capture?.pingState;
  if (!pingState) {
    return "printf 'SAFE_BOUNDARY\\trefused\\tsource-ping-state-missing\\n'; exit 2";
  }
  const quotedExecutable = shellQuote(executable);
  const quotedArgs = args.map(shellQuote).join(" ");
  return `set -eu
log="/tmp/machinen-move-loader-$$.log"
if [ -x /sbin/machinen-move-capture ]; then
  /sbin/machinen-move-capture --load-ping-state ${pingState.ntransmitted} ${pingState.nreceived} ${pingState.nerrors} --log "$log" -- ${quotedExecutable}${quotedArgs ? ` ${quotedArgs}` : ""}
else
  printf 'SAFE_BOUNDARY\trefused\tmissing-move-capture-agent\n'
fi`;
}

function moveSleepLoaderCommand(executable: string, secondsArg: string): string {
  return `set -eu
log="/tmp/machinen-move-loader-$$.log"
${shellQuote(executable)} ${shellQuote(secondsArg)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-sleep-started\n'
printf 'PATCH\tsleep-remaining\tready\t%s\n' ${shellQuote(secondsArg)}
`;
}

function sleepRemainingSecondsArg(remainingMs: number): string {
  return Math.max(1, Math.ceil(remainingMs / 1000)).toString();
}

function moveSleepPatchFromOutput(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): MoveLoadRendezvous["patch"] {
  const state =
    result.exitCode === 0 && result.stdout.includes("PATCH\tsleep-remaining\tready")
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

function moveSleepLoaderRefusals(
  patch: MoveLoadRendezvous["patch"] | undefined,
): NativeProcessImageRefusal[] {
  if (patch?.state === "ready") {
    return [];
  }
  return [
    loaderRefusal("target-sleep-remaining-time-missing", "target sleep loader failed", { patch }),
  ];
}

function moveTailLoaderCommand(executable: string, tailState: MoveTailState | undefined): string {
  if (!tailState) {
    return "printf 'PATCH\\ttail-offset\\trefused\\tmissing-tail-state\\n'; exit 2";
  }
  const offsetArg = `+${tailState.offset + 1}`;
  return `set -eu
log="/tmp/machinen-move-loader-$$.log"
test -f ${shellQuote(tailState.path)}
${shellQuote(executable)} -c ${shellQuote(offsetArg)} -f -- ${shellQuote(tailState.path)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-tail-follow-started\n'
printf 'PATCH\ttail-offset\tready\t%s\t%s\n' ${shellQuote(tailState.path)} ${shellQuote(String(tailState.offset))}
`;
}

function moveTailPatchFromOutput(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): MoveLoadRendezvous["patch"] {
  const state =
    result.exitCode === 0 && result.stdout.includes("PATCH\ttail-offset\tready")
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

function moveTailLoaderRefusals(
  patch: MoveLoadRendezvous["patch"] | undefined,
): NativeProcessImageRefusal[] {
  if (patch?.state === "ready") {
    return [];
  }
  return [
    loaderRefusal("target-fd-read-state-missing", "target tail offset loader failed", { patch }),
  ];
}

function moveScriptPtyLoaderCommand(
  executable: string,
  kind: "less" | "vi",
  state: MoveLessState | MoveViState | undefined,
): string {
  if (!state) {
    return `printf 'PATCH\\t${kind}-script-pty\\trefused\\tmissing-state\\n'; exit 2`;
  }
  const log = `/tmp/machinen-move-loader-$$.typescript`;
  const command = moveScriptPtyAppCommand(executable, kind, state);
  return `set -eu
log=${shellQuote(log)}
setsid sh -c ${shellQuote(`tail -f /dev/null | TERM=xterm script -q -c ${shellQuote(command)} "$1" >/dev/null 2>&1`)} sh "$log" >/dev/null 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-${kind}-script-pty-started\n'
printf 'PATCH\t${kind}-script-pty\tready\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(state.line))}
`;
}

function moveScriptPtyAppCommand(
  executable: string,
  kind: "less" | "vi",
  state: MoveLessState | MoveViState,
): string {
  const args = [shellQuote(executable), `+${state.line}`];
  if (kind === "vi") {
    const viState = state as MoveViState;
    if (viState.searchPattern) {
      args.push(shellQuote(`+/${viState.searchPattern}`));
    }
    if (viState.dirtyText !== undefined) {
      args.push(shellQuote(`+normal! Go${viState.dirtyText}`));
    }
  }
  args.push("--", shellQuote(state.path));
  return args.join(" ");
}

function moveScriptPtyPatchFromOutput(
  result: { stdout: string; stderr: string; exitCode: number },
  kind: "less" | "vi",
): MoveLoadRendezvous["patch"] {
  const state =
    result.exitCode === 0 && result.stdout.includes(`PATCH\t${kind}-script-pty\tready`)
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

function moveScriptPtyLoaderRefusals(
  patch: MoveLoadRendezvous["patch"] | undefined,
  message: string,
): NativeProcessImageRefusal[] {
  if (patch?.state === "ready") {
    return [];
  }
  return [loaderRefusal("target-process-context-unsupported", message, { patch })];
}

function parseRendezvousOutput(stdout: string): {
  pid?: number;
  logPath?: string;
  captureRows: string[];
} {
  const captureRows: string[] = [];
  let pid: number | undefined;
  let logPath: string | undefined;
  for (const row of stdout.split("\n").filter(Boolean)) {
    const parts = row.split("\t");
    if (parts[0] === "RENDEZVOUS_PID" || parts[0] === "LOAD_PID") {
      pid = parsePositiveInteger(parts[1] ?? "");
    } else if (parts[0] === "RENDEZVOUS_LOG" || parts[0] === "LOAD_LOG") {
      logPath = parts[1];
    } else {
      captureRows.push(row);
    }
  }
  return { pid, logPath, captureRows };
}

function moveRendezvousPatchFromOutput(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): MoveLoadRendezvous["patch"] {
  const state =
    result.exitCode === 0 &&
    result.stdout.includes("PATCH\tping-rts") &&
    result.stdout.includes("PATCH\tping-send-buffer\tready")
      ? "ready"
      : "refused";
  return {
    state,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}

function movePatchRefusals(
  patch: MoveLoadRendezvous["patch"] | undefined,
): NativeProcessImageRefusal[] {
  if (patch?.state === "ready") {
    return [];
  }
  return [
    loaderRefusal("target-frame-register-value-unavailable", "target ping state patch failed", {
      patch,
    }),
  ];
}

function moveRendezvousRefusals(capture: {
  safeBoundary?: { state: "sleep-timer" | "pre-send-icmp" | "refused"; detail: string };
  freeze?: { state: "ptrace-attached" | "refused"; detail: string };
  registers?: Record<string, unknown>;
}): NativeProcessImageRefusal[] {
  const refusals: NativeProcessImageRefusal[] = [];
  pushBoundaryRefusal(refusals, capture.safeBoundary);
  pushFreezeRefusal(refusals, capture.freeze);
  pushRegisterRefusal(refusals, capture.registers);
  return refusals;
}

function pushBoundaryRefusal(
  refusals: NativeProcessImageRefusal[],
  safeBoundary: { state: "sleep-timer" | "pre-send-icmp" | "refused"; detail: string } | undefined,
): void {
  if (safeBoundary?.state === "sleep-timer" || safeBoundary?.state === "pre-send-icmp") {
    return;
  }
  refusals.push(
    loaderRefusal(
      "active-syscall",
      "target ping direct loader did not reach the pre-send boundary",
      {
        boundary: safeBoundary?.detail ?? "missing",
      },
    ),
  );
}

function pushFreezeRefusal(
  refusals: NativeProcessImageRefusal[],
  freeze: { state: "ptrace-attached" | "refused"; detail: string } | undefined,
): void {
  if (freeze?.state === "ptrace-attached") {
    return;
  }
  refusals.push(
    loaderRefusal("thread-state-unsupported", "target ping was not frozen by direct loader", {
      freeze: freeze?.detail ?? "missing",
    }),
  );
}

function pushRegisterRefusal(
  refusals: NativeProcessImageRefusal[],
  registers: Record<string, unknown> | undefined,
): void {
  if (registers) {
    return;
  }
  refusals.push(
    loaderRefusal(
      "target-frame-register-value-unavailable",
      "target register state was not captured by direct loader",
      {},
    ),
  );
}

function loaderRefused(
  executable: string,
  argv: string[],
  parsed: { pid?: number; logPath?: string; captureRows: string[] },
  refusal: NativeProcessImageRefusal,
): MoveLoadRendezvous {
  return {
    state: "refused",
    strategy: "target-original-ping-direct-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    refusals: [refusal],
  };
}

function loaderRefusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  detail: Record<string, unknown>,
): NativeProcessImageRefusal {
  return { code, message, detail: { ...detail, boundary: "target-original-ping-direct-loader" } };
}

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
