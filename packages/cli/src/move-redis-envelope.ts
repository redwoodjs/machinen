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
type MoveRedisIdleState = NonNullable<MoveCapture["redisIdleState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveRedisIdleStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["redisIdleState"]> {
  const port = parseRedisIdlePort(node);
  if (!port || resourcePlan.resources.filter((resource) => resource.kind === "socket").length < 1) {
    return undefined;
  }
  const result = await vm.execRaw(redisIdlePreflightCommand(port, "redis-idle"), {
    execTimeoutMs: 30_000,
  });
  return result.exitCode === 0 && result.stdout.includes("REDIS_IDLE_OK")
    ? {
        port,
        argvContract: "redis-server-no-persistence-port",
        datasetState: "empty",
        clientState: "idle-no-external-clients",
        persistence: { save: "", appendonly: "no" },
        binaryPolicy: "proof-provisioned-target-native-redis",
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetRedisIdleLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.redisIdleState;
  const result = await vm.execRaw(moveRedisIdleLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "redis-idle");
  const refusals = moveNamedLoaderRefusals(patch, "target redis idle loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-native-redis-idle-loader",
    executable,
    argv: state
      ? [executable, "--save", "", "--appendonly", "no", "--port", String(state.port)]
      : [executable],
    targetPid: parseLoadPid(result.stdout),
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function parseRedisIdlePort(node: MovePidGraphNode): number | undefined {
  if (node.argv.length === 1) {
    const rewritten = (node.argv[0] ?? node.command).match(
      /^\/usr\/bin\/redis-server \*:(\d+)\s*$/,
    );
    const port = Number(rewritten?.[1]);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
  }
  if (moveCommandName(node) !== "redis-server" || node.argv.length !== 7) {
    return undefined;
  }
  const port = Number(node.argv[6]);
  return node.argv[1] === "--save" &&
    node.argv[2] === "" &&
    node.argv[3] === "--appendonly" &&
    node.argv[4] === "no" &&
    node.argv[5] === "--port" &&
    Number.isInteger(port) &&
    port > 0 &&
    port < 65536
    ? port
    : undefined;
}

function redisIdlePreflightCommand(port: number, patchName: string): string {
  return `set -eu
port=${shellQuote(String(port))}
if ! command -v redis-cli >/dev/null 2>&1; then
  printf 'PATCH\t${patchName}\trefused\tmissing-redis-cli\n'
  exit 2
fi
if ! redis-cli -h 127.0.0.1 -p "$port" PING 2>/dev/null | grep -qx PONG; then
  printf 'PATCH\t${patchName}\trefused\tnot-responding\n'
  exit 2
fi
if [ "$(redis-cli -h 127.0.0.1 -p "$port" DBSIZE)" != "0" ]; then
  printf 'PATCH\t${patchName}\trefused\tnon-empty-db\n'
  exit 2
fi
clients=$(redis-cli -h 127.0.0.1 -p "$port" INFO clients | awk -F: '$1 == "connected_clients" { sub(/\r$/, "", $2); print $2 }')
if [ "\${clients:-99}" -gt 1 ]; then
  printf 'PATCH\t${patchName}\trefused\tactive-clients\n'
  exit 2
fi
appendonly=$(redis-cli -h 127.0.0.1 -p "$port" CONFIG GET appendonly | tail -1 | tr -d '\r')
if [ "$appendonly" != "no" ]; then
  printf 'PATCH\t${patchName}\trefused\tappendonly-enabled\n'
  exit 2
fi
save_value=$(redis-cli -h 127.0.0.1 -p "$port" CONFIG GET save | tail -1 | tr -d '\r')
if [ -n "$save_value" ]; then
  printf 'PATCH\t${patchName}\trefused\tsave-enabled\n'
  exit 2
fi
printf 'REDIS_IDLE_OK\t%s\n' "$port"
`;
}

function moveRedisIdleLoaderCommand(
  executable: string,
  state: MoveRedisIdleState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\tredis-idle\\trefused\\tmissing-redis-idle-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const listenCheck = listenCheckCommand(state.port);
  return `set -eu
log=${shellQuote(log)}
if [ ! -x ${shellQuote(executable)} ]; then
  printf 'PATCH\tredis-idle\trefused\tmissing-redis-server\n'
  exit 2
fi
if ! command -v redis-cli >/dev/null 2>&1; then
  printf 'PATCH\tredis-idle\trefused\tmissing-redis-cli\n'
  exit 2
fi
if ${listenCheck}; then
  printf 'PATCH\tredis-idle\trefused\tport-in-use\n'
  exit 2
fi
${shellQuote(executable)} --save '' --appendonly no --port ${state.port} >"$log" 2>&1 &
pid=$!
ready=0
for _ in $(seq 1 40); do
  if ! kill -0 "$pid" 2>/dev/null; then
    printf 'LOAD_LOG\t%s\n' "$log"
    printf 'PATCH\tredis-idle\trefused\tstart-failed\n'
    exit 2
  fi
  if redis-cli -h 127.0.0.1 -p ${state.port} PING 2>/dev/null | grep -qx PONG; then
    ready=1
    break
  fi
  sleep 0.25
done
if [ "$ready" != "1" ]; then
  kill -TERM "$pid" 2>/dev/null || true
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\tredis-idle\trefused\tnot-listening\n'
  exit 2
fi
{
${redisIdlePreflightCommand(state.port, "redis-idle")}} >/tmp/machinen-redis-preflight-$$.txt
if ! grep -q '^REDIS_IDLE_OK' /tmp/machinen-redis-preflight-$$.txt; then
  kill -TERM "$pid" 2>/dev/null || true
  cat /tmp/machinen-redis-preflight-$$.txt
  rm -f /tmp/machinen-redis-preflight-$$.txt
  exit 2
fi
rm -f /tmp/machinen-redis-preflight-$$.txt
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-redis-idle-started\n'
printf 'PATCH\tredis-idle\tready\t%s\n' ${shellQuote(String(state.port))}
`;
}

function listenCheckCommand(port: number): string {
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

function moveRendezvousExecutable(_descriptor: MoveDescriptor): string {
  return "/usr/bin/redis-server";
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
