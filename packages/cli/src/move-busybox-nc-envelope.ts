import type {
  MoveDescriptor,
  MovePidGraphNode,
  NativeProcessImageRefusal,
  VmHandle,
} from "@machinen/runtime";
import { basename } from "node:path";
import type { MoveLoadDirectLoader } from "./move-rendezvous.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type MoveBusyboxNcState = NonNullable<MoveCapture["busyboxNcState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export function readMoveBusyboxNcState(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): MoveCapture["busyboxNcState"] {
  if (
    moveCommandName(node) !== "busybox" ||
    node.argv.length !== 5 ||
    node.argv[1] !== "nc" ||
    node.argv[2] !== "-l" ||
    node.argv[3] !== "-p" ||
    resourcePlan.resources.filter((resource) => resource.kind === "socket").length !== 1
  ) {
    return undefined;
  }
  const port = Number(node.argv[4]);
  return Number.isInteger(port) && port > 0 && port < 65536
    ? {
        port,
        argvContract: "busybox-nc-listen-p",
        listenerState: "idle-single-listener",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetBusyboxNcLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.busyboxNcState;
  const result = await vm.execRaw(moveBusyboxNcLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "busybox-nc");
  const refusals = moveNamedLoaderRefusals(patch, "target BusyBox nc loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-busybox-nc-listener-loader",
    executable,
    argv: state ? [executable, "nc", "-l", "-p", String(state.port)] : [executable],
    targetPid: parseLoadPid(result.stdout),
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveBusyboxNcLoaderCommand(
  executable: string,
  state: MoveBusyboxNcState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tbusybox-nc\\trefused\\tmissing-busybox-nc-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const listenCheck = busyboxNcListenCheck(state.port);
  return `set -eu
log=${shellQuote(log)}
if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\tbusybox-nc\trefused\tmissing-busybox\n'
  exit 2
fi
if ${listenCheck}; then
  printf 'PATCH\tbusybox-nc\trefused\tport-in-use\n'
  exit 2
fi
${shellQuote(executable)} nc -l -p ${state.port} >"$log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tbusybox-nc\trefused\tstart-failed\n'
    exit 2
  fi
  if ${listenCheck}; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tbusybox-nc\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-busybox-nc-started\n'
printf 'PATCH\tbusybox-nc\tready\t%s\n' ${shellQuote(String(state.port))}
`;
}

function busyboxNcListenCheck(port: number): string {
  const hexPort = port.toString(16).toUpperCase().padStart(4, "0");
  return `awk 'BEGIN { found = 1 } $4 == "0A" { split($2, a, ":"); if (toupper(a[2]) == "${hexPort}") found = 0 } END { exit found }' /proc/net/tcp /proc/net/tcp6 2>/dev/null`;
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

function parseLoadPid(stdout: string): number | undefined {
  const pid = Number(
    stdout
      .split("\n")
      .find((row) => row.startsWith("LOAD_PID\t"))
      ?.split("\t")[1],
  );
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function parseLogPath(stdout: string): string | undefined {
  return stdout
    .trim()
    .split("\n")
    .find((row) => row.startsWith("LOAD_LOG\t"))
    ?.split("\t")[1];
}

function moveRendezvousExecutable(descriptor: MoveDescriptor): string {
  return (
    descriptor.resourcePlan?.capture?.executablePackage?.path ??
    descriptor.nodes[0]?.exe ??
    "/usr/bin/busybox"
  );
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
