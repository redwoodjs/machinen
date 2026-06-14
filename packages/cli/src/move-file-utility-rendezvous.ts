import type { MoveDescriptor, NativeProcessImageRefusal, VmHandle } from "@machinen/runtime";

import {
  moveAwkFieldLoaderCommand,
  moveCommLoaderCommand,
  moveCutLoaderCommand,
  moveHeadLoaderCommand,
  moveJoinLoaderCommand,
  movePasteLoaderCommand,
  moveSedLoaderCommand,
  moveTailLinesLoaderCommand,
  moveUniqLoaderCommand,
} from "./move-envelope-loader-commands.ts";
import type { MoveLoadDirectLoader } from "./move-rendezvous.ts";

type MovePatch = MoveLoadDirectLoader["patch"];
type MoveCapture = NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>;
type MoveSedState = NonNullable<MoveCapture["sedState"]>;

export async function runMoveTargetHeadLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.headState;
  return runSimpleMoveLoader(
    vm,
    "target-original-head-file-loader",
    executable,
    [executable, "-n", String(state?.lines ?? 0), state?.path ?? ""],
    moveHeadLoaderCommand(executable, state),
    "head-file",
    "target head file loader failed",
  );
}

export async function runMoveTargetTailLinesLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.tailLinesState;
  return runSimpleMoveLoader(
    vm,
    "target-original-tail-lines-loader",
    executable,
    [executable, "-n", String(state?.lines ?? 0), state?.path ?? ""],
    moveTailLinesLoaderCommand(executable, state),
    "tail-lines",
    "target tail lines loader failed",
  );
}

export async function runMoveTargetSedLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.sedState;
  return runSimpleMoveLoader(
    vm,
    "target-original-sed-file-loader",
    executable,
    moveSedArgv(executable, state),
    moveSedLoaderCommand(executable, state),
    "sed-file",
    "target sed file loader failed",
  );
}

export async function runMoveTargetAwkFieldLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.awkFieldState;
  const script = `{print $${state?.fieldIndex ?? 0}}`;
  return runSimpleMoveLoader(
    vm,
    "target-original-awk-field-loader",
    executable,
    [executable, script, state?.path ?? ""],
    moveAwkFieldLoaderCommand(executable, state),
    "awk-field",
    "target awk field loader failed",
  );
}

export async function runMoveTargetCutLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.cutState;
  return runSimpleMoveLoader(
    vm,
    "target-original-cut-fields-loader",
    executable,
    [executable, "-d", state?.delimiter ?? "", "-f", state?.fields ?? "", state?.path ?? ""],
    moveCutLoaderCommand(executable, state),
    "cut-fields",
    "target cut fields loader failed",
  );
}

export async function runMoveTargetPasteLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.pasteState;
  return runSimpleMoveLoader(
    vm,
    "target-original-paste-files-loader",
    executable,
    [executable, state?.leftPath ?? "", state?.rightPath ?? ""],
    movePasteLoaderCommand(executable, state),
    "paste-files",
    "target paste files loader failed",
  );
}

export async function runMoveTargetUniqLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.uniqState;
  const argv = state?.count ? [executable, "-c", state.path] : [executable, state?.path ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-uniq-file-loader",
    executable,
    argv,
    moveUniqLoaderCommand(executable, state),
    "uniq-file",
    "target uniq file loader failed",
  );
}

export async function runMoveTargetCommLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.commState;
  return runSimpleMoveLoader(
    vm,
    "target-original-comm-files-loader",
    executable,
    [executable, state?.leftPath ?? "", state?.rightPath ?? ""],
    moveCommLoaderCommand(executable, state),
    "comm-files",
    "target comm files loader failed",
  );
}

export async function runMoveTargetJoinLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.joinState;
  return runSimpleMoveLoader(
    vm,
    "target-original-join-files-loader",
    executable,
    [executable, state?.leftPath ?? "", state?.rightPath ?? ""],
    moveJoinLoaderCommand(executable, state),
    "join-files",
    "target join files loader failed",
  );
}

function moveSedArgv(executable: string, state: MoveSedState | undefined): string[] {
  if (!state) {
    return [executable, "", ""];
  }
  if (state.scriptKind === "print-range") {
    return [executable, "-n", `${state.startLine},${state.endLine}p`, state.path];
  }
  return [executable, `s/${state.pattern}/${state.replacement}/`, state.path];
}

async function runSimpleMoveLoader(
  vm: VmHandle,
  strategy: MoveLoadDirectLoader["strategy"],
  executable: string,
  argv: string[],
  command: string,
  patchName: string,
  refusalMessage: string,
): Promise<MoveLoadDirectLoader> {
  const result = await vm.execRaw(command, { execTimeoutMs: 300_000 });
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

function parseRendezvousOutput(stdout: string): { pid?: number; logPath?: string } {
  const rows = stdout.trim().split("\n");
  const pid = Number(rows.find((row) => row.startsWith("LOAD_PID\t"))?.split("\t")[1]);
  const logPath = rows.find((row) => row.startsWith("LOAD_LOG\t"))?.split("\t")[1];
  return { pid: Number.isInteger(pid) && pid > 0 ? pid : undefined, logPath };
}

function moveNamedPatchFromOutput(
  result: { stdout: string; stderr: string; exitCode: number },
  patchName: string,
): MovePatch {
  const state =
    result.exitCode === 0 && result.stdout.includes(`PATCH\t${patchName}\tready`)
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

function moveNamedLoaderRefusals(
  patch: MovePatch | undefined,
  message: string,
): NativeProcessImageRefusal[] {
  return patch?.state === "ready"
    ? []
    : [{ code: "target-process-context-unsupported", message, detail: { patch } }];
}
