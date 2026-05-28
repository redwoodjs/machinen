import type { RegistryEntry, VmHandle } from "@machinen/runtime";

import {
  cleanServiceObservableStateDecisions,
  cleanServiceSecurityAssertions,
  normalizeCleanServiceRefusal,
  runtimePolicyFor,
} from "./manifest.ts";
import type {
  CleanServiceCapture,
  CleanServiceComponent,
  CleanServiceKernelResourceReport,
} from "./manifest.ts";

interface PortableGoProbePayload {
  refusal?: { code: string; message: string };
  sourceCwd?: string;
  argv?: string[];
  runtimeVersion?: string;
  guestPort?: number;
  verifier?: CleanServiceComponent["verifier"];
  kernelResources?: CleanServiceKernelResourceReport;
  executableRelativePath?: string;
  appTarBase64?: string;
}

// fallow-ignore-next-line complexity
export async function inspectPortableGoVm(
  // fallow-ignore-next-line code-duplication
  vm: VmHandle,
  entry: RegistryEntry | undefined,
  opts: { guestCpu: () => "arm64" | "amd64"; sha256Bytes: (bytes: Buffer | string) => string },
): Promise<CleanServiceCapture | undefined> {
  const guestPort = entry?.portForward?.[0]?.guestPort ?? 3000;
  // fallow-ignore-next-line code-duplication
  const probe = await vm.execRaw(portableGoProbeCommand(guestPort), { execTimeoutMs: 15_000 });
  if (probe.exitCode !== 0 || probe.stdout.trim() === "") {
    return undefined;
  }
  // fallow-ignore-next-line code-duplication
  const parsed = JSON.parse(probe.stdout.trim()) as PortableGoProbePayload;
  if (parsed.refusal) {
    const refusal = normalizeCleanServiceRefusal(parsed.refusal);
    throw new Error(`SNAPSHOT_CLEAN_SERVICE_REFUSED ${refusal.code}: ${refusal.message}`);
  }
  if (!parsed.appTarBase64 || !parsed.sourceCwd || !parsed.argv || !parsed.executableRelativePath) {
    return undefined;
  }
  const appBytes = Buffer.from(parsed.appTarBase64, "base64");
  const artifactPath = "clean-service-go-primary.tar.gz";
  return {
    kind: "machinen.clean-service-snapshot",
    formatVersion: 1,
    sourceArch: opts.guestCpu(),
    snapshotEngine: "vmstate",
    routePolicy: "target-native-clean-service-when-target-arch-differs",
    observableStateDecisions: cleanServiceObservableStateDecisions(),
    components: [
      {
        id: "go:primary-http-service",
        runtime: "go",
        subset: "go-http-clean-root-v1",
        sourceCwd: parsed.sourceCwd,
        argv: parsed.argv,
        runtimeVersion: parsed.runtimeVersion ?? "static-go-binary",
        runtimePolicy: runtimePolicyFor("go"),
        guestPort: parsed.guestPort ?? guestPort,
        verifier: parsed.verifier!,
        kernelResources: parsed.kernelResources,
        artifact: {
          path: artifactPath,
          sha256: opts.sha256Bytes(appBytes),
          bytes: appBytes.byteLength,
        },
        provenance: {
          sourceCwd: parsed.sourceCwd,
          argv: parsed.argv,
          executableRelativePath: parsed.executableRelativePath,
          cgoPolicy: "refuse CGO_ENABLED=1 or dynamically linked binaries",
        },
        refusals: [],
      },
    ],
    security: cleanServiceSecurityAssertions(),
    artifactBytesByPath: { [artifactPath]: appBytes },
  };
}

// fallow-ignore-next-line complexity
function portableGoProbeCommand(guestPort: number): string {
  return String.raw`set -eu
json_escape() { sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n'; }
refusal() {
  code=$1
  message=$2
  printf '{"refusal":{"code":"%s","message":"%s"}}\n' "$(printf '%s' "$code" | json_escape)" "$(printf '%s' "$message" | json_escape)"
  exit 0
}
found_pid=
self=$$
for proc in /proc/[0-9]*; do
  pid=\${proc#/proc/}
  [ "$pid" = "$self" ] && continue
  [ -r "$proc/exe" ] || continue
  exe=$(readlink "$proc/exe" 2>/dev/null || true)
  [ -n "$exe" ] || continue
  [ -r "$exe" ] || continue
  if command -v strings >/dev/null 2>&1 && strings "$exe" 2>/dev/null | grep -Eq 'Go build ID|runtime\.main'; then
    found_pid=$pid
    found_exe=$exe
    break
  fi
done
[ -n "$found_pid" ] || exit 2
cwd=$(readlink "/proc/$found_pid/cwd" 2>/dev/null || true)
[ -n "$cwd" ] || exit 2
case "$cwd" in /mnt|/mnt/*) refusal go-host-mounted-state-ambiguous 'Go cwd is on a host mount; dirty mounted state cannot be proven portable' ;; esac
case "$found_exe" in "$cwd"/*) executable_relative=\${found_exe#"$cwd"/} ;; *) refusal go-executable-outside-root-unsupported 'Go executable must live inside the captured clean service root' ;; esac
if command -v readelf >/dev/null 2>&1; then
  if readelf -l "$found_exe" 2>/dev/null | grep -q 'Requesting program interpreter'; then
    refusal go-dynamic-binary-unsupported 'Go clean-service restore only supports statically linked target-native binaries without ELF PT_INTERP'
  fi
elif command -v file >/dev/null 2>&1 && file "$found_exe" 2>/dev/null | grep -qi 'dynamically linked'; then
  refusal go-dynamic-binary-unsupported 'Go clean-service restore only supports statically linked target-native binaries'
fi
if command -v go >/dev/null 2>&1 && go version -m "$found_exe" 2>/dev/null | grep -q 'CGO_ENABLED=1'; then
  refusal go-cgo-state-unsupported 'CGO/native library state is not portable in go-http-clean-root-v1'
elif command -v strings >/dev/null 2>&1 && strings "$found_exe" 2>/dev/null | grep -q 'CGO_ENABLED=1'; then
  refusal go-cgo-state-unsupported 'CGO/native library state is not portable in go-http-clean-root-v1'
fi
for proc in /proc/[0-9]*; do
  pid=\${proc#/proc/}
  [ "$pid" = "$found_pid" ] && continue
  [ -r "$proc/stat" ] || continue
  ppid=$(awk '{print $4}' "$proc/stat" 2>/dev/null || true)
  [ "$ppid" = "$found_pid" ] && refusal go-child-process-tree-unsupported 'Go child process trees are not portable yet'
done
socket_inodes=$(mktemp)
trap 'rm -f "$socket_inodes" "$body_file" "$tar_file"' EXIT
for fd in /proc/$found_pid/fd/*; do
  link=$(readlink "$fd" 2>/dev/null || true)
  case "$link" in socket:\[*\]) printf '%s\n' "\${link#socket:[}" | tr -d ']' >>"$socket_inodes" ;; esac
done
for net in /proc/net/tcp /proc/net/tcp6; do
  [ -r "$net" ] || continue
  awk 'NR>1 && $4 != "0A" {print $10}' "$net" | while read -r inode; do
    if grep -qx "$inode" "$socket_inodes"; then refusal go-active-tcp-session-unsupported 'Active TCP/TLS sessions are not portable in the Go HTTP subset yet'; fi
  done
done
body_file=$(mktemp)
tar_file=$(mktemp)
if ! curl -fsS "http://127.0.0.1:${guestPort}/" >"$body_file" 2>/dev/null; then
  refusal go-target-verifier-missing 'Go HTTP root verifier on the detected service port did not succeed'
fi
body_sha=$(sha256sum "$body_file" | awk '{print $1}')
body_bytes=$(wc -c <"$body_file" | tr -d ' ')
tar -C "$cwd" -czf "$tar_file" .
app_b64=$(base64 <"$tar_file" | tr -d '\n')
kernel_resources='{"decisionModel":"supported-irrelevant-refused","supported":["clean-service-go-static-elf-no-interpreter"],"irrelevant":[],"refused":[],"summary":{"supported":1,"irrelevant":0,"refused":0}}'
runtime_version=static-go-binary
if command -v strings >/dev/null 2>&1; then
  if strings "$found_exe" 2>/dev/null | grep -m1 '^go1\.' >/tmp/machinen-go-version.$$; then
    runtime_version=$(cat /tmp/machinen-go-version.$$)
    rm -f /tmp/machinen-go-version.$$
  fi
fi
argv_json='['
first=1
tr '\0' '\n' <"/proc/$found_pid/cmdline" | while IFS= read -r arg; do
  [ -n "$arg" ] || continue
  if [ "$first" -eq 0 ]; then printf ','; fi
  first=0
  printf '"%s"' "$(printf '%s' "$arg" | json_escape)"
done >/tmp/machinen-go-argv.$$
argv_json="$argv_json$(cat /tmp/machinen-go-argv.$$)]"
rm -f /tmp/machinen-go-argv.$$
printf '{"sourceCwd":"%s","argv":%s,"runtimeVersion":"%s","guestPort":%s,"verifier":{"kind":"http-get","path":"/","sha256":"%s","bytes":%s},"kernelResources":%s,"executableRelativePath":"%s","appTarBase64":"%s"}\n' \
  "$(printf '%s' "$cwd" | json_escape)" "$argv_json" "$(printf '%s' "$runtime_version" | json_escape)" "${guestPort}" "$body_sha" "$body_bytes" "$kernel_resources" "$(printf '%s' "$executable_relative" | json_escape)" "$app_b64"`;
}
