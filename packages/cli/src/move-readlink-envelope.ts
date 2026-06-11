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
type MoveReadlinkState = NonNullable<MoveCapture["readlinkState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveReadlinkStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["readlinkState"]> {
  const linkPath = moveReadlinkPath(node);
  if (!linkPath) {
    return undefined;
  }
  const result = await vm.execRaw(moveReadlinkPreflightCommand(linkPath, "readlink-direct"), {
    execTimeoutMs: 10_000,
  });
  const parsed = parseReadlinkPreflight(result.stdout);
  return result.exitCode === 0 && parsed
    ? {
        linkPath,
        targetLiteral: parsed.targetLiteral,
        linkIdentity: { mode: parsed.mode, targetDigest: parsed.targetDigest },
        options: [],
        policy: "direct-symlink-literal-target",
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetReadlinkLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.readlinkState;
  const result = await vm.execRaw(moveReadlinkLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "readlink-direct");
  const refusals = moveNamedLoaderRefusals(patch, "target readlink loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-readlink-direct-loader",
    executable,
    argv: [executable, state?.linkPath ?? ""],
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveReadlinkPath(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "readlink" || node.argv.length !== 2) {
    return undefined;
  }
  const linkPath = node.argv[1];
  return linkPath?.startsWith("/") && linkPath !== "/" && safeAbsolutePath(linkPath)
    ? linkPath
    : undefined;
}

function moveReadlinkPreflightCommand(linkPath: string, patchName: string): string {
  return `set -eu
link=${shellQuote(linkPath)}
[ -L "$link" ]
target=$(readlink "$link")
if ! printf '%s' "$target" | LC_ALL=C grep -Eq '^[A-Za-z0-9._/-]+$'; then
  printf 'PATCH\t${patchName}\trefused\tunsafe-target-literal\n'
  exit 2
fi
mode=$(stat -c %f "$link")
target_digest=$(printf '%s' "$target" | sha256sum | cut -d' ' -f1)
printf '%s\n%s\n%s\n' "$target" "$mode" "$target_digest"
`;
}

function moveReadlinkLoaderCommand(
  executable: string,
  state: MoveReadlinkState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\treadlink-direct\\trefused\\tmissing-readlink-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  return `set -eu
log=${shellQuote(log)}
{
${moveReadlinkPreflightCommand(state.linkPath, "readlink-direct")}} >/tmp/machinen-readlink-preflight-$$.txt
actual_target=$(sed -n '1p' /tmp/machinen-readlink-preflight-$$.txt)
actual_mode=$(sed -n '2p' /tmp/machinen-readlink-preflight-$$.txt)
actual_target_digest=$(sed -n '3p' /tmp/machinen-readlink-preflight-$$.txt)
rm -f /tmp/machinen-readlink-preflight-$$.txt
if [ "$actual_target" != ${shellQuote(state.targetLiteral)} ] || [ "$actual_mode" != ${shellQuote(state.linkIdentity.mode)} ] || [ "$actual_target_digest" != ${shellQuote(state.linkIdentity.targetDigest)} ]; then
  printf 'PATCH\treadlink-direct\trefused\tchanged-link-identity\n'
  exit 2
fi
if ! ${shellQuote(executable)} -- ${shellQuote(state.linkPath)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\treadlink-direct\trefused\treadlink-failed\n'
  exit 2
fi
post=$(cat "$log")
if [ "$post" != ${shellQuote(state.targetLiteral)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\treadlink-direct\trefused\tunexpected-readlink-output\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-readlink-direct-completed\n'
printf 'PATCH\treadlink-direct\tready\t%s\t%s\t%s\n' ${shellQuote(state.linkPath)} ${shellQuote(state.targetLiteral)} ${shellQuote(state.linkIdentity.targetDigest)}
`;
}

function parseReadlinkPreflight(
  stdout: string,
): { targetLiteral: string; mode: string; targetDigest: string } | undefined {
  const [targetLiteral, mode, targetDigest] = stdout.trimEnd().split("\n");
  return targetLiteral !== undefined &&
    targetLiteral.length > 0 &&
    /^[0-9a-f]+$/.test(mode ?? "") &&
    /^[0-9a-f]{64}$/.test(targetDigest ?? "")
    ? { targetLiteral, mode: mode as string, targetDigest: targetDigest as string }
    : undefined;
}

function moveStdoutFilePath(resourcePlan: MoveResourcePlan): string | undefined {
  const stdout = resourcePlan.resources.find((resource) => resource.fd === 1);
  return stdout?.kind === "file" && typeof stdout.path === "string" ? stdout.path : undefined;
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
    "/usr/bin/readlink"
  );
}

function moveCommandName(node: MovePidGraphNode): string {
  return basename(node.argv[0] ?? node.command ?? node.exe);
}

function safeAbsolutePath(path: string): boolean {
  return path.split("/").filter(Boolean).every(safePathComponent);
}

function safePathComponent(component: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(component) && component !== "." && component !== "..";
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
