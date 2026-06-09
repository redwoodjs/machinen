import type { MoveDescriptor, NativeProcessImageRefusal, VmHandle } from "@machinen/runtime";

import { moveNodeStaticHttpLoaderCommand } from "./move-node-static-loader.ts";
import { parseGuestMoveResourceScan } from "./move-resource-plan.ts";

export interface MoveLoadDirectLoader {
  state: "ready" | "refused";
  strategy:
    | "target-original-ping-direct-loader"
    | "target-original-sleep-remaining-loader"
    | "target-original-tail-offset-loader"
    | "target-original-less-script-pty-loader"
    | "target-original-vi-readonly-script-pty-loader"
    | "target-original-cat-offset-loader"
    | "target-original-grep-offset-loader"
    | "target-original-watch-loop-loader"
    | "target-original-sh-script-pty-loader"
    | "target-original-python-http-server-loader"
    | "target-original-tail-grep-pipeline-loader"
    | "target-original-dd-offset-loader"
    | "target-original-find-cursor-loader"
    | "target-original-tar-create-loader"
    | "target-original-node-static-http-loader";
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
type MoveReaderState = NonNullable<MoveCapture["readerState"]>;
type MoveGrepState = NonNullable<MoveCapture["grepState"]>;
type MoveWatchState = NonNullable<MoveCapture["watchState"]>;
type MoveShellState = NonNullable<MoveCapture["shellState"]>;
type MoveHttpState = NonNullable<MoveCapture["httpState"]>;
type MoveTailGrepPipelineState = NonNullable<MoveCapture["tailGrepPipelineState"]>;
type MoveDdState = NonNullable<MoveCapture["ddState"]>;
type MoveFindState = NonNullable<MoveCapture["findState"]>;
type MoveTarState = NonNullable<MoveCapture["tarState"]>;
type MoveTargetDirectLoaderRunner = (
  vm: VmHandle,
  descriptor: MoveDescriptor,
) => Promise<MoveLoadRendezvous>;

export async function runMoveTargetDirectLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const envelopeLoader = moveTargetEnvelopeLoader(descriptor);
  if (envelopeLoader) {
    return envelopeLoader(vm, descriptor);
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

// fallow-ignore-next-line complexity
function moveTargetEnvelopeLoader(
  descriptor: MoveDescriptor,
): MoveTargetDirectLoaderRunner | undefined {
  const capture = descriptor.resourcePlan?.capture;
  const loaders: Array<[unknown, MoveTargetDirectLoaderRunner]> = [
    [capture?.sleepState, runMoveTargetSleepLoaderInVm],
    [capture?.tailState, runMoveTargetTailLoaderInVm],
    [capture?.lessState, runMoveTargetLessLoaderInVm],
    [capture?.viState, runMoveTargetViLoaderInVm],
    [capture?.readerState, runMoveTargetReaderLoaderInVm],
    [capture?.grepState, runMoveTargetGrepLoaderInVm],
    [capture?.watchState, runMoveTargetWatchLoaderInVm],
    [capture?.shellState, runMoveTargetShellLoaderInVm],
    [capture?.httpState, runMoveTargetHttpLoaderInVm],
    [capture?.tailGrepPipelineState, runMoveTargetTailGrepPipelineLoaderInVm],
    [capture?.ddState, runMoveTargetDdLoaderInVm],
    [capture?.findState, runMoveTargetFindLoaderInVm],
    [capture?.tarState, runMoveTargetTarLoaderInVm],
    [capture?.nodeStaticHttpState, runMoveTargetNodeStaticHttpLoaderInVm],
  ];
  return loaders.find(([state]) => state)?.[1];
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

async function runMoveTargetReaderLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.readerState;
  const argv = [executable, state?.path ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-cat-offset-loader",
    executable,
    argv,
    moveReaderLoaderCommand(executable, state),
    "reader-offset",
    "target cat offset loader failed",
  );
}

async function runMoveTargetGrepLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.grepState;
  const argv = [executable, state?.pattern ?? "", state?.path ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-grep-offset-loader",
    executable,
    argv,
    moveGrepLoaderCommand(executable, state),
    "grep-offset",
    "target grep offset loader failed",
  );
}

async function runMoveTargetWatchLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.watchState;
  const argv = [executable, "-n", String(state?.intervalSeconds ?? 2), ...(state?.command ?? [])];
  return runSimpleMoveLoader(
    vm,
    "target-original-watch-loop-loader",
    executable,
    argv,
    moveWatchLoaderCommand(executable, state),
    "watch-loop",
    "target watch loop loader failed",
  );
}

async function runMoveTargetShellLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.shellState;
  const argv = [executable];
  return runSimpleMoveLoader(
    vm,
    "target-original-sh-script-pty-loader",
    executable,
    argv,
    moveShellLoaderCommand(executable, state),
    "sh-script-pty",
    "target shell script-pty loader failed",
  );
}

async function runMoveTargetHttpLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.httpState;
  const argv = [executable, "-m", "http.server", String(state?.port ?? 8000)];
  return runSimpleMoveLoader(
    vm,
    "target-original-python-http-server-loader",
    executable,
    argv,
    moveHttpLoaderCommand(executable, state),
    "python-http-server",
    "target python http server loader failed",
  );
}

async function runMoveTargetNodeStaticHttpLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.nodeStaticHttpState;
  const argv = [executable, state?.scriptPath ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-node-static-http-loader",
    executable,
    argv,
    moveNodeStaticHttpLoaderCommand(executable, state),
    "node-static-http",
    "target node static http loader failed",
  );
}

async function runMoveTargetTarLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.tarState;
  const argv = [executable, "-cf", state?.archivePath ?? "", state?.sourceDir ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-tar-create-loader",
    executable,
    argv,
    moveTarLoaderCommand(executable, state),
    "tar-create",
    "target tar create loader failed",
  );
}

async function runMoveTargetFindLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.findState;
  const argv = [executable, state?.rootPath ?? "", "-type", "f", "-print"];
  return runSimpleMoveLoader(
    vm,
    "target-original-find-cursor-loader",
    executable,
    argv,
    moveFindLoaderCommand(executable, state),
    "find-cursor",
    "target find cursor loader failed",
  );
}

async function runMoveTargetDdLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.ddState;
  const argv = state
    ? [
        executable,
        `if=${state.inputPath}`,
        `of=${state.outputPath}`,
        `bs=${state.blockSize}`,
        `skip=${state.outputOffset}`,
        `seek=${state.outputOffset}`,
        "iflag=skip_bytes",
        "oflag=seek_bytes",
        "conv=notrunc",
      ]
    : [executable];
  return runSimpleMoveLoader(
    vm,
    "target-original-dd-offset-loader",
    executable,
    argv,
    moveDdLoaderCommand(executable, state),
    "dd-offset",
    "target dd offset loader failed",
  );
}

async function runMoveTargetTailGrepPipelineLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
  const state = descriptor.resourcePlan?.capture?.tailGrepPipelineState;
  const executable = "/bin/sh";
  const argv = [
    executable,
    "-c",
    `tail -c +${(state?.offset ?? 0) + 1} -f -- ${state?.tailPath ?? ""} | grep --line-buffered -- ${state?.pattern ?? ""}`,
  ];
  return runSimpleMoveLoader(
    vm,
    "target-original-tail-grep-pipeline-loader",
    executable,
    argv,
    moveTailGrepPipelineLoaderCommand(state),
    "tail-grep-pipeline",
    "target tail-grep pipeline loader failed",
  );
}

async function runSimpleMoveLoader(
  vm: VmHandle,
  strategy: MoveLoadDirectLoader["strategy"],
  executable: string,
  argv: string[],
  command: string,
  patchName: string,
  refusalMessage: string,
): Promise<MoveLoadRendezvous> {
  const result = await vm.execRaw(command, { execTimeoutMs: 30_000 });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveNamedPatchFromOutput(result, patchName);
  const refusals = moveNamedLoaderRefusals(patch, refusalMessage);
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy,
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

function moveReaderLoaderCommand(executable: string, state: MoveReaderState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\treader-offset\\trefused\\tmissing-reader-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
exec 3<${shellQuote(state.path)}
dd bs=1 count=${state.offset} <&3 >/dev/null 2>&1 || true
${shellQuote(executable)} <&3 >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-reader-offset-started\n'
printf 'PATCH\treader-offset\tready\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(state.offset))}
`;
}

function moveGrepLoaderCommand(executable: string, state: MoveGrepState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tgrep-offset\\trefused\\tmissing-grep-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
exec 3<${shellQuote(state.path)}
dd bs=1 count=${state.offset} <&3 >/dev/null 2>&1 || true
${shellQuote(executable)} -- ${shellQuote(state.pattern)} <&3 >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-grep-offset-started\n'
printf 'PATCH\tgrep-offset\tready\t%s\t%s\n' ${shellQuote(state.path)} ${shellQuote(String(state.offset))}
`;
}

function moveWatchLoaderCommand(executable: string, state: MoveWatchState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\twatch-loop\\trefused\\tmissing-watch-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.typescript";
  const command = [
    shellQuote(executable),
    "-n",
    shellQuote(String(state.intervalSeconds)),
    ...state.command.map(shellQuote),
  ].join(" ");
  return `set -eu
log=${shellQuote(log)}
setsid sh -c ${shellQuote(`tail -f /dev/null | TERM=xterm script -q -c ${shellQuote(command)} "$1" >/dev/null 2>&1`)} sh "$log" >/dev/null 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-watch-loop-started\n'
printf 'PATCH\twatch-loop\tready\t%s\t%s\n' ${shellQuote(String(state.intervalSeconds))} ${shellQuote(state.command.join(" "))}
`;
}

function moveShellLoaderCommand(executable: string, state: MoveShellState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tsh-script-pty\\trefused\\tmissing-shell-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.typescript";
  const command = `cd ${shellQuote(state.cwd)} && exec ${shellQuote(executable)}`;
  return `set -eu
log=${shellQuote(log)}
setsid sh -c ${shellQuote(`tail -f /dev/null | TERM=xterm script -q -c ${shellQuote(command)} "$1" >/dev/null 2>&1`)} sh "$log" >/dev/null 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-sh-script-pty-started\n'
printf 'PATCH\tsh-script-pty\tready\t%s\n' ${shellQuote(state.cwd)}
`;
}

function moveHttpLoaderCommand(executable: string, state: MoveHttpState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tpython-http-server\\trefused\\tmissing-http-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const probe = `import socket; s=socket.create_connection(("127.0.0.1", ${state.port}), 2); s.close()`;
  return `set -eu
log=${shellQuote(log)}
if [ ! -d ${shellQuote(state.cwd)} ]; then
  printf 'PATCH\tpython-http-server\trefused\tmissing-cwd\n'
  exit 2
fi
if ${shellQuote(executable)} -c ${shellQuote(probe)} >/dev/null 2>&1; then
  printf 'PATCH\tpython-http-server\trefused\tport-in-use\n'
  exit 2
fi
(cd ${shellQuote(state.cwd)} && ${shellQuote(executable)} -m http.server ${state.port} --bind 127.0.0.1 >"$log" 2>&1) &
pid=$!
ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tpython-http-server\trefused\tstart-failed\n'
    exit 2
  fi
  if ${shellQuote(executable)} -c ${shellQuote(probe)} >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tpython-http-server\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-python-http-server-started\n'
printf 'PATCH\tpython-http-server\tready\t%s\t%s\n' ${shellQuote(state.cwd)} ${shellQuote(String(state.port))}
`;
}

function moveTarLoaderCommand(executable: string, state: MoveTarState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\ttar-create\\trefused\\tmissing-tar-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
rm -f ${shellQuote(state.archivePath)}
${shellQuote(executable)} -cf ${shellQuote(state.archivePath)} ${shellQuote(state.sourceDir)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-tar-create-started\n'
printf 'PATCH\ttar-create\tready\t%s\t%s\n' ${shellQuote(state.archivePath)} ${shellQuote(state.sourceDir)}
`;
}

function moveFindLoaderCommand(executable: string, state: MoveFindState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tfind-cursor\\trefused\\tmissing-find-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const last = state.lastPath ?? "";
  return `set -eu
log=${shellQuote(log)}
${shellQuote(executable)} ${shellQuote(state.rootPath)} -type f -print | awk -v last=${shellQuote(last)} 'BEGIN { emit = (last == "") } emit { print; next } $0 == last { emit = 1; next }' >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-find-cursor-started\n'
printf 'PATCH\tfind-cursor\tready\t%s\t%s\n' ${shellQuote(state.rootPath)} ${shellQuote(last)}
`;
}

function moveDdLoaderCommand(executable: string, state: MoveDdState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\tdd-offset\\trefused\\tmissing-dd-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const argv = [
    shellQuote(executable),
    `if=${shellQuote(state.inputPath)}`,
    `of=${shellQuote(state.outputPath)}`,
    `bs=${shellQuote(String(state.blockSize))}`,
    `skip=${shellQuote(String(state.outputOffset))}`,
    `seek=${shellQuote(String(state.outputOffset))}`,
    "iflag=skip_bytes",
    "oflag=seek_bytes",
    "conv=notrunc",
  ].join(" ");
  return `set -eu
log=${shellQuote(log)}
${argv} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-dd-offset-started\n'
printf 'PATCH\tdd-offset\tready\t%s\t%s\t%s\t%s\n' ${shellQuote(state.inputPath)} ${shellQuote(state.outputPath)} ${shellQuote(String(state.inputOffset))} ${shellQuote(String(state.outputOffset))}
`;
}

function moveTailGrepPipelineLoaderCommand(state: MoveTailGrepPipelineState | undefined): string {
  if (!state) {
    return "printf 'PATCH\\ttail-grep-pipeline\\trefused\\tmissing-tail-grep-pipeline-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const tailArgv = ["tail", "-c", `+${state.offset + 1}`, "-f", "--", state.tailPath]
    .map(shellQuote)
    .join(" ");
  const grepArgv = ["grep", "--line-buffered", "--", state.pattern].map(shellQuote).join(" ");
  return `set -eu
log=${shellQuote(log)}
setsid sh -c ${shellQuote(`${tailArgv} | ${grepArgv} >"$1" 2>&1`)} sh "$log" >/dev/null 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-tail-grep-pipeline-started\n'
printf 'PATCH\ttail-grep-pipeline\tready\t%s\t%s\t%s\n' ${shellQuote(state.tailPath)} ${shellQuote(String(state.offset))} ${shellQuote(state.pattern)}
`;
}

function moveNamedPatchFromOutput(
  result: { stdout: string; stderr: string; exitCode: number },
  patchName: string,
): MoveLoadRendezvous["patch"] {
  const state =
    result.exitCode === 0 && result.stdout.includes(`PATCH\t${patchName}\tready`)
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

function moveNamedLoaderRefusals(
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
