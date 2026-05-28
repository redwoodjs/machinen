import type { RegistryEntry, VmHandle } from "@machinen/runtime";

import {
  cleanServiceObservableStateDecisions,
  cleanServiceSecurityAssertions,
  normalizeCleanServiceRefusal,
  runtimePolicyFor,
  type CleanServiceCapture,
  type CleanServiceComponent,
  type CleanServiceKernelResourceReport,
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
    kernelResources?: CleanServiceKernelResourceReport;
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
    observableStateDecisions: cleanServiceObservableStateDecisions(),
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
        kernelResources: parsed.kernelResources,
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
    payload = {'refusal': {'code': code, 'message': message}}
    if 'kernel_resources' in globals():
        payload['kernelResources'] = kernel_resources
    print(json.dumps(payload))
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
kernel_resources = {'decisionModel': 'supported-irrelevant-refused', 'supported': [], 'irrelevant': [], 'refused': [], 'summary': {'supported': 0, 'irrelevant': 0, 'refused': 0}}
def decision(kind, code):
    kernel_resources[kind].append(code)
    kernel_resources['summary'][kind] += 1

def inside(path, root):
    return path == root or path.startswith(root.rstrip('/') + '/')

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
            fd_num = int(fd.name)
            link = os.readlink(fd)
        except Exception:
            continue
        if fd_num <= 2:
            decision('irrelevant', 'clean-service-stdio-fd-irrelevant')
            continue
        if link.startswith('socket:[') and link.endswith(']'):
            socket_inodes.add(link[8:-1])
            decision('supported', 'clean-service-socket-fd-modeled')
            continue
        if link.endswith(' (deleted)'):
            refusal('python-deleted-open-file-unsupported', 'Deleted-but-open files are not portable clean-service state')
        if link.startswith('pipe:['):
            decision('supported', 'clean-service-runtime-pipe-recreated-by-startup')
            continue
        if link.startswith('fifo:['):
            refusal('python-open-fd-unsupported', 'FIFOs require an explicit clean-service descriptor model')
        if link == 'anon_inode:[eventpoll]':
            decision('supported', 'clean-service-epoll-recreated-by-runtime-start')
            continue
        if link == 'anon_inode:[eventfd]':
            decision('supported', 'clean-service-eventfd-recreated-by-runtime-start')
            continue
        if link == 'anon_inode:[timerfd]':
            refusal('python-timerfd-state-unsupported', 'timerfd deadlines are not replayed by clean-service restore')
        if link == 'anon_inode:[signalfd]':
            refusal('python-signalfd-state-unsupported', 'signalfd and pending signal state are not modeled by clean-service restore')
        if link.startswith('/') and inside(link, cwd):
            decision('supported', 'clean-service-app-root-fd-captured')
            continue
        if link.startswith('/dev/'):
            decision('irrelevant', 'clean-service-runtime-device-fd-irrelevant')
            continue
        if link.startswith('/'):
            refusal('python-open-fd-unsupported', 'Open regular file outside the captured app root is not portable without provenance: ' + link)
for net in ('/proc/net/tcp', '/proc/net/tcp6'):
    try:
        lines = Path(net).read_text().strip().splitlines()[1:]
    except Exception:
        continue
    for line in lines:
        cols = line.split()
        if len(cols) > 9 and cols[9] in socket_inodes:
            port = int(cols[1].split(':')[1], 16)
            if cols[3] == '0A':
                if port != ${guestPort}:
                    refusal('python-unexpected-listener-unsupported', 'Listening socket is not declared by the clean-service verifier model')
                decision('supported', 'clean-service-listener-rebound')
            else:
                refusal('python-active-tcp-session-unsupported', 'Active TCP/TLS sessions are not portable in the Python clean-service subset yet')
try:
    unix_lines = Path('/proc/net/unix').read_text().strip().splitlines()[1:]
except Exception:
    unix_lines = []
for line in unix_lines:
    cols = line.split()
    if len(cols) > 6 and cols[6] in socket_inodes:
        refusal('python-unix-socket-unsupported', 'Unix sockets require an explicit clean-service descriptor model')
try:
    map_lines = Path(f"/proc/{found['pid']}/maps").read_text().strip().splitlines()
except Exception:
    map_lines = []
for line in map_lines:
    cols = line.split()
    if len(cols) < 6:
        continue
    perms = cols[1]
    path = ' '.join(cols[5:])
    if len(perms) > 3 and perms[1] == 'w' and perms[3] == 's':
        refusal('python-shared-memory-unsupported', 'Writable shared mappings are not modeled by clean-service restore')
    if any(part in path.lower() for part in ('/pg_wal/', '/wal/', 'sqlite', 'ib_logfile', '/mysql/', '/mariadb/')):
        refusal('python-mmapped-durable-state-unsupported', 'Mmapped database or WAL files require a service-specific logical capture path')
    if inside(path, cwd) and path.endswith(('.so', '.pyd')):
        refusal('python-native-extension-state-unsupported', 'Python native extension state is architecture-specific and is not portable yet')
    if path.startswith(('/lib/', '/usr/lib/', '/lib64/')):
        decision('supported', 'clean-service-runtime-library-from-target-policy')
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
    'kernelResources': kernel_resources,
    'appTarBase64': app_b64,
}
print(json.dumps(out))
PY`;
}
