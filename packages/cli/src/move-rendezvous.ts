import type { MoveDescriptor, NativeProcessImageRefusal, VmHandle } from "@machinen/runtime";

import { parseGuestMoveResourceScan } from "./move-resource-plan.ts";

export interface MoveLoadDirectLoader {
  state: "ready" | "refused";
  strategy: "target-original-ping-direct-loader";
  executable: string;
  argv: string[];
  targetPid?: number;
  logPath?: string;
  capture?: unknown;
  patch?: { state: "ready" | "refused"; stdout: string; stderr: string; exitCode: number };
  refusals: NativeProcessImageRefusal[];
}

export type MoveLoadRendezvous = MoveLoadDirectLoader;

export async function runMoveTargetDirectLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadRendezvous> {
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

export const runMoveTargetRendezvousInVm = runMoveTargetDirectLoaderInVm;

function parsePositiveInteger(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
