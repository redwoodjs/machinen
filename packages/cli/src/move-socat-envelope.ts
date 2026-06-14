import type {
  MoveDescriptor,
  MovePidGraphNode,
  NativeProcessImageRefusal,
  VmHandle,
} from "@machinen/runtime";
import { basename } from "node:path";
import {
  activeTcpConnectionCheckCommand,
  listeningTcpPortCheckCommand,
  safeAbsolutePath,
  shellQuote,
} from "./move-preflight-helpers.ts";
import type { MoveLoadDirectLoader } from "./move-rendezvous.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type MoveSocatFileResponderState = NonNullable<MoveCapture["socatFileResponderState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveSocatFileResponderStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  nodes: MovePidGraphNode[],
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["socatFileResponderState"]> {
  const parsed = parseSocatFileResponderArgs(node);
  if (
    !parsed ||
    nodes.some((item) => item.ppid === node.pid) ||
    resourcePlan.resources.filter((resource) => resource.kind === "socket").length !== 3
  ) {
    return undefined;
  }
  const result = await vm.execRaw(
    socatFileIdentityCommand(parsed.filePath, "socat-file-responder", parsed.port),
    {
      execTimeoutMs: 30_000,
    },
  );
  const fileIdentity = parseFileIdentity(result.stdout);
  return result.exitCode === 0 && fileIdentity
    ? {
        port: parsed.port,
        filePath: parsed.filePath,
        fileIdentity,
        argvContract: "socat-tcp-listen-fork-reuseaddr-file",
        listenerState: "idle-single-listener",
        binaryPolicy: "proof-provisioned-target-native-socat",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetSocatFileResponderLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.socatFileResponderState;
  const result = await vm.execRaw(moveSocatFileResponderLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "socat-file-responder");
  const refusals = moveNamedLoaderRefusals(patch, "target socat file responder loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-native-socat-file-responder-loader",
    executable,
    argv: state
      ? [executable, `TCP-LISTEN:${state.port},fork,reuseaddr`, `FILE:${state.filePath}`]
      : [executable],
    targetPid: parseLoadPid(result.stdout),
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function parseSocatFileResponderArgs(
  node: MovePidGraphNode,
): { port: number; filePath: string } | undefined {
  if (moveCommandName(node) !== "socat" || node.argv.length !== 3) {
    return undefined;
  }
  const listen = node.argv[1]?.match(/^TCP-LISTEN:(\d+),fork,reuseaddr$/);
  const filePath = node.argv[2]?.startsWith("FILE:") ? node.argv[2].slice(5) : undefined;
  const port = Number(listen?.[1]);
  return Number.isInteger(port) &&
    port > 0 &&
    port < 65536 &&
    filePath?.startsWith("/") &&
    safeAbsolutePath(filePath)
    ? { port, filePath }
    : undefined;
}

function socatFileIdentityCommand(path: string, patchName: string, port?: number): string {
  const activeCheck = port
    ? `${activeTcpConnectionCheckCommand(port)} && { printf 'PATCH\\t${patchName}\\trefused\\tactive-client\\n'; exit 2; }\n`
    : "";
  return `set -eu
path=${shellQuote(path)}
${activeCheck}if [ ! -f "$path" ] || [ -L "$path" ]; then
  printf 'PATCH\t${patchName}\trefused\tunsupported-file\n'
  exit 2
fi
printf '%s\n%s\n' "$(stat -c %s "$path")" "$(sha256sum "$path" | cut -d' ' -f1)"
`;
}

function moveSocatFileResponderLoaderCommand(
  executable: string,
  state: MoveSocatFileResponderState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tsocat-file-responder\\trefused\\tmissing-socat-file-responder-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const listenCheck = listeningTcpPortCheckCommand(state.port);
  return `set -eu
log=${shellQuote(log)}
if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\tsocat-file-responder\trefused\tmissing-socat\n'
  exit 2
fi
{
${socatFileIdentityCommand(state.filePath, "socat-file-responder")}} >/tmp/machinen-socat-file-preflight-$$.txt
actual_size=$(sed -n '1p' /tmp/machinen-socat-file-preflight-$$.txt)
actual_sha256=$(sed -n '2p' /tmp/machinen-socat-file-preflight-$$.txt)
rm -f /tmp/machinen-socat-file-preflight-$$.txt
if [ "$actual_size" != ${shellQuote(String(state.fileIdentity.size))} ] || [ "$actual_sha256" != ${shellQuote(state.fileIdentity.sha256)} ]; then
  printf 'PATCH\tsocat-file-responder\trefused\tchanged-file-identity\n'
  exit 2
fi
if ${listenCheck}; then
  printf 'PATCH\tsocat-file-responder\trefused\tport-in-use\n'
  exit 2
fi
${shellQuote(executable)} ${shellQuote(`TCP-LISTEN:${state.port},fork,reuseaddr`)} ${shellQuote(`FILE:${state.filePath}`)} >"$log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 20); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tsocat-file-responder\trefused\tstart-failed\n'
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
  printf 'PATCH\tsocat-file-responder\trefused\tnot-listening\n'
  exit 2
fi
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-socat-file-responder-started\n'
printf 'PATCH\tsocat-file-responder\tready\t%s\t%s\n' ${shellQuote(String(state.port))} ${shellQuote(state.fileIdentity.sha256)}
`;
}

function parseFileIdentity(
  stdout: string,
): MoveSocatFileResponderState["fileIdentity"] | undefined {
  const [sizeLine, sha256] = stdout.trim().split("\n");
  const size = Number(sizeLine);
  return Number.isSafeInteger(size) && size >= 0 && /^[0-9a-f]{64}$/.test(sha256 ?? "")
    ? { size, sha256: sha256 as string }
    : undefined;
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
    "/usr/bin/socat"
  );
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}
