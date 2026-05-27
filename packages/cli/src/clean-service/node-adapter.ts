import type { RegistryEntry, VmHandle } from "@machinen/runtime";

import {
  cleanServiceSecurityAssertions,
  normalizeCleanServiceRefusal,
  runtimePolicyFor,
  type CleanServiceCapture,
  type CleanServiceKernelResourceReport,
} from "./manifest.ts";

export interface PortableNodeSnapshotBundle {
  kind: "machinen.portable-node-snapshot";
  formatVersion: 1;
  sourceArch: "arm64" | "amd64";
  runtime: "node";
  subset: "node-http-clean-root-v1";
  sourceCwd: string;
  argv: string[];
  nodeVersion: string;
  guestPort: number;
  verifier: { kind: "http-get"; path: "/"; sha256: string; bytes: number };
  kernelResources?: CleanServiceKernelResourceReport;
  appTar: { path: "portable-node-app.tar.gz"; sha256: string; bytes: number };
  refusals: [];
}

export type PortableNodeSnapshotCapture = PortableNodeSnapshotBundle & { appTarBytes: Buffer };

// fallow-ignore-next-line complexity
export async function inspectPortableNodeVm(
  vm: VmHandle,
  entry: RegistryEntry | undefined,
  opts: { guestCpu: () => "arm64" | "amd64"; sha256Bytes: (bytes: Buffer | string) => string },
): Promise<PortableNodeSnapshotCapture | undefined> {
  const guestPort = entry?.portForward?.[0]?.guestPort ?? 3000;
  const probe = await vm.execRaw(portableNodeProbeCommand(guestPort, opts.guestCpu()), {
    execTimeoutMs: 15_000,
  });
  if (probe.exitCode !== 0 || probe.stdout.trim() === "") {
    return undefined;
  }
  const parsed = JSON.parse(probe.stdout.trim()) as Omit<PortableNodeSnapshotBundle, "appTar"> & {
    capture?: boolean;
    refusal?: { code: string; message: string };
    appTarBase64?: string;
  };
  if (parsed.refusal) {
    const refusal = normalizeCleanServiceRefusal(parsed.refusal);
    throw new Error(`SNAPSHOT_PORTABLE_NODE_REFUSED ${refusal.code}: ${refusal.message}`);
  }
  if (!parsed.appTarBase64) {
    return undefined;
  }
  const appBytes = Buffer.from(parsed.appTarBase64, "base64");
  return {
    kind: "machinen.portable-node-snapshot",
    formatVersion: 1,
    sourceArch: opts.guestCpu(),
    runtime: "node",
    subset: "node-http-clean-root-v1",
    sourceCwd: parsed.sourceCwd,
    argv: parsed.argv,
    nodeVersion: parsed.nodeVersion,
    guestPort: parsed.guestPort,
    verifier: parsed.verifier,
    kernelResources: parsed.kernelResources,
    appTar: {
      path: "portable-node-app.tar.gz",
      sha256: opts.sha256Bytes(appBytes),
      bytes: appBytes.byteLength,
    },
    refusals: [],
    appTarBytes: appBytes,
  };
}

export function cleanServiceFromNode(bundle: PortableNodeSnapshotCapture): CleanServiceCapture {
  const artifactPath = "clean-service-node-primary.tar.gz";
  return {
    kind: "machinen.clean-service-snapshot",
    formatVersion: 1,
    sourceArch: bundle.sourceArch,
    snapshotEngine: "vmstate",
    routePolicy: "target-native-clean-service-when-target-arch-differs",
    components: [
      {
        id: "nodejs:primary-http-service",
        runtime: "node",
        subset: bundle.subset,
        sourceCwd: bundle.sourceCwd,
        argv: bundle.argv,
        runtimeVersion: bundle.nodeVersion,
        runtimePolicy: runtimePolicyFor("node"),
        guestPort: bundle.guestPort,
        verifier: bundle.verifier,
        kernelResources: bundle.kernelResources,
        artifact: { ...bundle.appTar, path: artifactPath },
        provenance: {
          sourceCwd: bundle.sourceCwd,
          argv: bundle.argv,
          nodeVersion: bundle.nodeVersion,
        },
        refusals: [],
      },
    ],
    security: cleanServiceSecurityAssertions(),
    artifactBytesByPath: { [artifactPath]: bundle.appTarBytes },
  };
}

// fallow-ignore-next-line complexity
function portableNodeProbeCommand(guestPort: number, guestArch: "arm64" | "amd64"): string {
  return String.raw`node - <<'NODE'
const { execFileSync, execSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { existsSync, readFileSync, readdirSync, readlinkSync } = require('node:fs');
function sh(cmd) { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
const self = String(process.pid);
const pids = sh("ls -d /proc/[0-9]* 2>/dev/null | sed 's#/proc/##'").split(/\n+/).filter(Boolean);
let found;
for (const pid of pids) {
  if (pid === self) continue;
  const cmdlinePath = "/proc/" + pid + "/cmdline";
  if (!existsSync(cmdlinePath)) continue;
  const argv = readFileSync(cmdlinePath).toString().split('\0').filter(Boolean);
  if (argv.length === 0) continue;
  if (/node(?:$|[0-9.-])/.test(argv[0].split('/').pop() || '') || argv[0] === 'node') {
    found = { pid, argv };
    break;
  }
}
if (!found) process.exit(2);
if (found.argv.some((arg) => arg === '--inspect' || arg.startsWith('--inspect=') || arg.startsWith('--inspect-brk'))) {
  console.log(JSON.stringify({ refusal: { code: 'node-inspector-session-unsupported', message: 'Node inspector/debug sessions are not portable across architectures yet' } }));
  process.exit(0);
}
const cwd = sh("readlink /proc/" + found.pid + "/cwd");
if (cwd === '/mnt' || cwd.startsWith('/mnt/')) {
  console.log(JSON.stringify({ refusal: { code: 'node-host-mounted-state-ambiguous', message: 'Node cwd is on a host mount; dirty mounted state cannot be proven portable' } }));
  process.exit(0);
}
const child = pids.find((pid) => pid !== found.pid && existsSync('/proc/' + pid + '/stat') && readFileSync('/proc/' + pid + '/stat', 'utf8').split(' ')[3] === found.pid);
if (child) {
  console.log(JSON.stringify({ refusal: { code: 'node-child-process-tree-unsupported', message: 'Node child process or IPC trees are not portable yet' } }));
  process.exit(0);
}
const nativeAddon = sh("find " + JSON.stringify(cwd) + " -type f -name '*.node' -print -quit 2>/dev/null || true");
if (nativeAddon) {
  console.log(JSON.stringify({ refusal: { code: 'node-native-addon-abi-state-unsupported', message: 'Native addon state is architecture-specific and is not portable yet' } }));
  process.exit(0);
}
const kernelResources = { decisionModel: 'supported-irrelevant-refused', supported: [], irrelevant: [], refused: [], summary: { supported: 0, irrelevant: 0, refused: 0 } };
function decision(kind, code, message) { kernelResources[kind].push(code); kernelResources.summary[kind] += 1; return { code, message }; }
function refuse(code, message) { const refusal = decision('refused', code, message); console.log(JSON.stringify({ refusal, kernelResources })); process.exit(0); }
function inside(path, root) { return path === root || path.startsWith(root.replace(/\/+$/, '') + '/'); }
const socketInodes = new Set();
for (const fd of readdirSync('/proc/' + found.pid + '/fd')) {
  try {
    const fdNum = Number(fd);
    const link = readlinkSync('/proc/' + found.pid + '/fd/' + fd);
    if (fdNum <= 2) { decision('irrelevant', 'clean-service-stdio-fd-irrelevant', 'stdio descriptors are not part of clean-service continuation state'); continue; }
    const match = /^socket:\[(\d+)\]$/.exec(link);
    if (match) { socketInodes.add(match[1]); decision('supported', 'clean-service-socket-fd-modeled', 'socket fd will be evaluated by socket table inspection'); continue; }
    if (link.endsWith(' (deleted)')) refuse('node-deleted-open-file-unsupported', 'Deleted-but-open files are not portable clean-service state');
    if (link.startsWith('pipe:[')) { decision('supported', 'clean-service-runtime-pipe-recreated-by-startup', 'runtime pipe fd is recreated by target-native process startup'); continue; }
    if (link.startsWith('fifo:[')) refuse('node-open-fd-unsupported', 'FIFOs require an explicit clean-service descriptor model');
    if (link === 'anon_inode:[eventpoll]') { decision('supported', 'clean-service-epoll-recreated-by-runtime-start', 'epoll fd is recreated by target-native runtime startup'); continue; }
    if (link === 'anon_inode:[eventfd]') { decision('supported', 'clean-service-eventfd-recreated-by-runtime-start', 'eventfd is recreated by target-native runtime startup'); continue; }
    if (link === 'anon_inode:[timerfd]') refuse('node-timerfd-state-unsupported', 'timerfd deadlines are not replayed by clean-service restore');
    if (link === 'anon_inode:[signalfd]') refuse('node-signalfd-state-unsupported', 'signalfd and pending signal state are not modeled by clean-service restore');
    if (link.startsWith('/') && inside(link, cwd)) { decision('supported', 'clean-service-app-root-fd-captured', 'open file is inside the captured app root'); continue; }
    if (link.startsWith('/dev/')) { decision('irrelevant', 'clean-service-runtime-device-fd-irrelevant', 'runtime device fd is recreated by target-native startup'); continue; }
    if (link.startsWith('/')) refuse('node-open-fd-unsupported', 'Open regular file outside the captured app root is not portable without provenance: ' + link);
  } catch {}
}
for (const net of ['/proc/net/tcp', '/proc/net/tcp6']) {
  if (!existsSync(net)) continue;
  for (const line of readFileSync(net, 'utf8').trim().split(/\n/).slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (!socketInodes.has(cols[9])) continue;
    const port = Number.parseInt(cols[1].split(':')[1], 16);
    if (cols[3] === '0A') {
      if (port !== ${guestPort}) refuse('node-unexpected-listener-unsupported', 'Listening socket is not declared by the clean-service verifier model');
      decision('supported', 'clean-service-listener-rebound', 'expected listener socket will be rebound by target-native service start');
    } else {
      refuse('node-active-tcp-session-unsupported', 'Active TCP/TLS sessions are not portable in the Node HTTP subset yet');
    }
  }
}
if (existsSync('/proc/net/unix')) {
  for (const line of readFileSync('/proc/net/unix', 'utf8').trim().split(/\n/).slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (socketInodes.has(cols[6])) refuse('node-unix-socket-unsupported', 'Unix sockets require an explicit clean-service descriptor model');
  }
}
if (existsSync('/proc/' + found.pid + '/maps')) {
  for (const line of readFileSync('/proc/' + found.pid + '/maps', 'utf8').trim().split(/\n/)) {
    const cols = line.trim().split(/\s+/);
    const perms = cols[1] || '';
    const path = cols.slice(5).join(' ');
    if (!path) continue;
    if (perms[1] === 'w' && perms[3] === 's') refuse('node-shared-memory-unsupported', 'Writable shared mappings are not modeled by clean-service restore');
    if (/(^|\/)(pg_wal|wal|sqlite|sqlite-wal|ib_logfile|mysql|mariadb|.*\.sqlite3?)(\.|\/|$)/i.test(path)) refuse('node-mmapped-durable-state-unsupported', 'Mmapped database or WAL files require a service-specific logical capture path');
    if (inside(path, cwd) && /\.node$/.test(path)) refuse('node-native-addon-abi-state-unsupported', 'Native addon state is architecture-specific and is not portable yet');
    if (path.startsWith('/lib/') || path.startsWith('/usr/lib/') || path.startsWith('/lib64/')) decision('supported', 'clean-service-runtime-library-from-target-policy', 'runtime shared library is supplied by target runtime policy');
  }
}
let body;
try {
  body = execFileSync('curl', ['-fsS', 'http://127.0.0.1:${guestPort}/'], { encoding: 'utf8', timeout: 5000 });
} catch {
  console.log(JSON.stringify({ refusal: { code: 'node-target-verifier-missing', message: 'Node HTTP root verifier on the detected service port did not succeed' } }));
  process.exit(0);
}
const appTarBase64 = execSync("tar -C " + JSON.stringify(cwd) + " -czf - . | base64 | tr -d '\\n'", { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const out = {
  kind: 'machinen.portable-node-snapshot',
  formatVersion: 1,
  sourceArch: '${guestArch}',
  runtime: 'node',
  subset: 'node-http-clean-root-v1',
  sourceCwd: cwd,
  argv: found.argv,
  nodeVersion: process.version,
  guestPort: ${guestPort},
  verifier: { kind: 'http-get', path: '/', sha256: createHash('sha256').update(body).digest('hex'), bytes: Buffer.byteLength(body) },
  kernelResources,
  refusals: [],
  appTarBase64
};
console.log(JSON.stringify(out));
NODE`;
}
