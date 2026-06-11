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
type MoveRealpathState = NonNullable<MoveCapture["realpathState"]>;
type MovePatch = MoveLoadDirectLoader["patch"];

export async function readMoveRealpathStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<MoveCapture["realpathState"]> {
  const inputPath = moveRealpathPath(node);
  const cwd = node.cwd;
  if (!inputPath || !cwd?.startsWith("/") || !safeAbsolutePath(cwd)) {
    return undefined;
  }
  const result = await vm.execRaw(moveRealpathPreflightCommand(inputPath, "realpath-path"), {
    execTimeoutMs: 10_000,
  });
  const parsed = parseRealpathPreflight(result.stdout);
  return result.exitCode === 0 && parsed
    ? {
        cwd,
        inputPath,
        resolvedPath: parsed.resolvedPath,
        chainIdentity: {
          componentCount: parsed.componentCount,
          symlinkCount: parsed.symlinkCount,
          chainDigest: parsed.chainDigest,
        },
        outputDigest: parsed.outputDigest,
        options: [],
        policy: "absolute-existing-path-safe-chain",
        outputPath: moveStdoutFilePath(resourcePlan),
        capturedAt: new Date().toISOString(),
      }
    : undefined;
}

export async function runMoveTargetRealpathLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.realpathState;
  const result = await vm.execRaw(moveRealpathLoaderCommand(executable, state), {
    execTimeoutMs: 30_000,
  });
  const patch = moveNamedPatchFromOutput(result, "realpath-path");
  const refusals = moveNamedLoaderRefusals(patch, "target realpath loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-realpath-path-loader",
    executable,
    argv: [executable, state?.inputPath ?? ""],
    logPath: parseLogPath(result.stdout),
    patch,
    refusals,
  };
}

function moveRealpathPath(node: MovePidGraphNode): string | undefined {
  if (moveCommandName(node) !== "realpath" || node.argv.length !== 2) {
    return undefined;
  }
  const inputPath = node.argv[1];
  return inputPath?.startsWith("/") && inputPath !== "/" && safeAbsolutePath(inputPath)
    ? inputPath
    : undefined;
}

function moveRealpathPreflightCommand(inputPath: string, patchName: string): string {
  return `set -eu
input=${shellQuote(inputPath)}
[ -e "$input" ]
resolved=$(realpath -- "$input")
if ! printf '%s' "$resolved" | LC_ALL=C grep -Eq '^(/[A-Za-z0-9._-]+)+$'; then
  printf 'PATCH\t${patchName}\trefused\tunsafe-resolved-path\n'
  exit 2
fi
chain_file=/tmp/machinen-realpath-chain-$$.txt
: >"$chain_file"
record_components() {
  path="$1"
  prefix=""
  path="\${path#/}"
  old_ifs="$IFS"
  IFS=/
  for part in $path; do
    [ -n "$part" ] || continue
    prefix="$prefix/$part"
    [ -e "$prefix" ] || [ -L "$prefix" ]
    if [ -L "$prefix" ]; then
      printf '%s\tsymlink\t%s\t%s\n' "$prefix" "$(stat -c %f "$prefix")" "$(readlink "$prefix")" >>"$chain_file"
    else
      printf '%s\tnode\t%s\t%s\n' "$prefix" "$(stat -c %F "$prefix")" "$(stat -c %f "$prefix")" >>"$chain_file"
    fi
  done
  IFS="$old_ifs"
}
record_components "$input"
record_components "$resolved"
component_count=$(wc -l <"$chain_file" | tr -d ' ')
symlink_count=$(awk -F '\t' '$2 == "symlink" { n++ } END { print n + 0 }' "$chain_file")
chain_digest=$(LC_ALL=C sort "$chain_file" | sha256sum | cut -d' ' -f1)
output_digest=$(printf '%s\n' "$resolved" | sha256sum | cut -d' ' -f1)
printf '%s\n%s\n%s\n%s\n%s\n' "$resolved" "$component_count" "$symlink_count" "$chain_digest" "$output_digest"
rm -f "$chain_file"
`;
}

function moveRealpathLoaderCommand(
  executable: string,
  state: MoveRealpathState | undefined,
): string {
  if (!state) {
    return "printf 'PATCH\\trealpath-path\\trefused\\tmissing-realpath-state\\n'; exit 2";
  }
  const log = "/tmp/machinen-move-loader-$$.log";
  const chain = state.chainIdentity;
  return `set -eu
log=${shellQuote(log)}
{
${moveRealpathPreflightCommand(state.inputPath, "realpath-path")}} >/tmp/machinen-realpath-preflight-$$.txt
actual_resolved=$(sed -n '1p' /tmp/machinen-realpath-preflight-$$.txt)
actual_component_count=$(sed -n '2p' /tmp/machinen-realpath-preflight-$$.txt)
actual_symlink_count=$(sed -n '3p' /tmp/machinen-realpath-preflight-$$.txt)
actual_chain_digest=$(sed -n '4p' /tmp/machinen-realpath-preflight-$$.txt)
actual_output_digest=$(sed -n '5p' /tmp/machinen-realpath-preflight-$$.txt)
rm -f /tmp/machinen-realpath-preflight-$$.txt
if [ "$actual_resolved" != ${shellQuote(state.resolvedPath)} ] || [ "$actual_component_count" != ${shellQuote(String(chain.componentCount))} ] || [ "$actual_symlink_count" != ${shellQuote(String(chain.symlinkCount))} ] || [ "$actual_chain_digest" != ${shellQuote(chain.chainDigest)} ] || [ "$actual_output_digest" != ${shellQuote(state.outputDigest)} ]; then
  printf 'PATCH\trealpath-path\trefused\tchanged-realpath-chain\n'
  exit 2
fi
if ! ${shellQuote(executable)} -- ${shellQuote(state.inputPath)} >"$log" 2>&1; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\trealpath-path\trefused\trealpath-failed\n'
  exit 2
fi
post=$(cat "$log")
if [ "$post" != ${shellQuote(state.resolvedPath)} ]; then
  printf 'LOAD_LOG\t%s\n' "$log"
  printf 'PATCH\trealpath-path\trefused\tunexpected-realpath-output\n'
  exit 2
fi
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-realpath-path-completed\n'
printf 'PATCH\trealpath-path\tready\t%s\t%s\t%s\n' ${shellQuote(state.inputPath)} ${shellQuote(state.resolvedPath)} ${shellQuote(chain.chainDigest)}
`;
}

function parseRealpathPreflight(stdout: string):
  | {
      resolvedPath: string;
      componentCount: number;
      symlinkCount: number;
      chainDigest: string;
      outputDigest: string;
    }
  | undefined {
  const [resolvedPath, componentLine, symlinkLine, chainDigest, outputDigest] = stdout
    .trim()
    .split("\n");
  const componentCount = Number(componentLine);
  const symlinkCount = Number(symlinkLine);
  return resolvedPath?.startsWith("/") &&
    safeAbsolutePath(resolvedPath) &&
    Number.isSafeInteger(componentCount) &&
    componentCount > 0 &&
    Number.isSafeInteger(symlinkCount) &&
    symlinkCount >= 0 &&
    /^[0-9a-f]{64}$/.test(chainDigest ?? "") &&
    /^[0-9a-f]{64}$/.test(outputDigest ?? "")
    ? {
        resolvedPath,
        componentCount,
        symlinkCount,
        chainDigest: chainDigest as string,
        outputDigest: outputDigest as string,
      }
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
    "/usr/bin/realpath"
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
