import type { RegistryEntry, VmHandle } from "@machinen/runtime";

import {
  cleanServiceSecurityAssertions,
  normalizeCleanServiceRefusal,
  runtimePolicyFor,
  type CleanServiceCapture,
  type CleanServiceComponent,
} from "./manifest.ts";

// fallow-ignore-next-line complexity
export async function inspectPortablePythonVm(
  // fallow-ignore-next-line code-duplication
  vm: VmHandle,
  entry: RegistryEntry | undefined,
  opts: { guestCpu: () => "arm64" | "amd64"; sha256Bytes: (bytes: Buffer | string) => string },
): Promise<CleanServiceCapture | undefined> {
  const guestPort = entry?.portForward?.[0]?.guestPort ?? 3000;
  // fallow-ignore-next-line code-duplication
  const probe = await vm.execRaw(portablePythonProbeCommand(guestPort), { execTimeoutMs: 15_000 });
  if (probe.exitCode !== 0 || probe.stdout.trim() === "") {
    return undefined;
  }
  // fallow-ignore-next-line code-duplication
  const parsed = JSON.parse(probe.stdout.trim()) as {
    refusal?: { code: string; message: string };
    sourceCwd?: string;
    argv?: string[];
    pythonVersion?: string;
    guestPort?: number;
    verifier?: CleanServiceComponent["verifier"];
    appTarBase64?: string;
  };
  if (parsed.refusal) {
    const refusal = normalizeCleanServiceRefusal(parsed.refusal);
    throw new Error(`SNAPSHOT_CLEAN_SERVICE_REFUSED ${refusal.code}: ${refusal.message}`);
  }
  if (!parsed.appTarBase64 || !parsed.sourceCwd || !parsed.argv || !parsed.pythonVersion) {
    return undefined;
  }
  const appBytes = Buffer.from(parsed.appTarBase64, "base64");
  const artifactPath = "clean-service-python-primary.tar.gz";
  return {
    kind: "machinen.clean-service-snapshot",
    formatVersion: 1,
    sourceArch: opts.guestCpu(),
    snapshotEngine: "vmstate",
    routePolicy: "target-native-clean-service-when-target-arch-differs",
    components: [
      {
        id: "python:primary-http-service",
        runtime: "python",
        subset: "python-http-clean-root-v1",
        sourceCwd: parsed.sourceCwd,
        argv: parsed.argv,
        runtimeVersion: parsed.pythonVersion,
        runtimePolicy: runtimePolicyFor("python"),
        guestPort: parsed.guestPort ?? guestPort,
        verifier: parsed.verifier!,
        artifact: {
          path: artifactPath,
          sha256: opts.sha256Bytes(appBytes),
          bytes: appBytes.byteLength,
        },
        provenance: {
          sourceCwd: parsed.sourceCwd,
          argv: parsed.argv,
          pythonVersion: parsed.pythonVersion,
        },
        refusals: [],
      },
    ],
    security: cleanServiceSecurityAssertions(),
    artifactBytesByPath: { [artifactPath]: appBytes },
  };
}

// fallow-ignore-next-line complexity
function portablePythonProbeCommand(guestPort: number): string {
  return String.raw`pybin=$(command -v python3 || command -v python3.11) || exit 2
"$pybin" - <<'PY'
import base64, hashlib, json, os, subprocess, sys, tarfile, tempfile
from pathlib import Path

def read_cmdline(pid):
    try:
        return [part for part in Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0') if part]
    except Exception:
        return []

def refusal(code, message):
    print(json.dumps({'refusal': {'code': code, 'message': message}}))
    raise SystemExit(0)

self_pid = str(os.getpid())
found = None
for name in os.listdir('/proc'):
    if not name.isdigit() or name == self_pid:
        continue
    argv_b = read_cmdline(name)
    if not argv_b:
        continue
    argv = [part.decode('utf-8', 'replace') for part in argv_b]
    base = os.path.basename(argv[0])
    if base in ('python', 'python3') or base.startswith('python3.'):
        found = {'pid': name, 'argv': argv}
        break
if not found:
    raise SystemExit(2)
try:
    cwd = os.readlink(f"/proc/{found['pid']}/cwd")
except OSError:
    raise SystemExit(2)
if cwd == '/mnt' or cwd.startswith('/mnt/'):
    refusal('python-host-mounted-state-ambiguous', 'Python cwd is on a host mount; dirty mounted state cannot be proven portable')
try:
    tasks = [entry for entry in os.listdir(f"/proc/{found['pid']}/task") if entry.isdigit()]
    if len(tasks) > 1:
        refusal('python-thread-state-unsupported', 'Python thread state is not portable in the clean-service subset yet')
except OSError:
    pass
for name in os.listdir('/proc'):
    if not name.isdigit() or name == found['pid']:
        continue
    try:
        stat = Path(f'/proc/{name}/stat').read_text().split()
    except Exception:
        continue
    if len(stat) > 3 and stat[3] == found['pid']:
        refusal('python-child-process-tree-unsupported', 'Python child process or IPC trees are not portable yet')
for root, _dirs, files in os.walk(cwd):
    for file in files:
        if file.endswith(('.so', '.pyd')):
            refusal('python-native-extension-state-unsupported', 'Python native extension state is architecture-specific and is not portable yet')
socket_inodes = set()
fd_dir = Path(f"/proc/{found['pid']}/fd")
if fd_dir.exists():
    for fd in fd_dir.iterdir():
        try:
            link = os.readlink(fd)
        except OSError:
            continue
        if link.startswith('socket:[') and link.endswith(']'):
            socket_inodes.add(link[8:-1])
for net in ('/proc/net/tcp', '/proc/net/tcp6'):
    try:
        lines = Path(net).read_text().strip().splitlines()[1:]
    except Exception:
        continue
    for line in lines:
        cols = line.split()
        if len(cols) > 9 and cols[9] in socket_inodes and cols[3] != '0A':
            refusal('python-active-tcp-session-unsupported', 'Active TCP/TLS sessions are not portable in the Python clean-service subset yet')
try:
    body = subprocess.check_output(['curl', '-fsS', 'http://127.0.0.1:${guestPort}/'], text=False, timeout=5)
except Exception:
    refusal('python-target-verifier-missing', 'Python HTTP root verifier on the detected service port did not succeed')
with tempfile.NamedTemporaryFile(suffix='.tar.gz') as tmp:
    with tarfile.open(tmp.name, 'w:gz') as tar:
        tar.add(cwd, arcname='.')
    tmp.seek(0)
    app_b64 = base64.b64encode(tmp.read()).decode('ascii')
out = {
    'sourceCwd': cwd,
    'argv': found['argv'],
    'pythonVersion': 'Python ' + sys.version.split()[0],
    'guestPort': ${guestPort},
    'verifier': {'kind': 'http-get', 'path': '/', 'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)},
    'appTarBase64': app_b64,
}
print(json.dumps(out))
PY`;
}
