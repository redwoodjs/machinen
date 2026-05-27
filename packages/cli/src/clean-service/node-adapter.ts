import type { RegistryEntry, VmHandle } from "@machinen/runtime";

import {
  cleanServiceSecurityAssertions,
  normalizeCleanServiceRefusal,
  runtimePolicyFor,
  type CleanServiceCapture,
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
const socketInodes = new Set();
for (const fd of readdirSync('/proc/' + found.pid + '/fd')) {
  try {
    const link = readlinkSync('/proc/' + found.pid + '/fd/' + fd);
    const match = /^socket:\[(\d+)\]$/.exec(link);
    if (match) socketInodes.add(match[1]);
  } catch {}
}
for (const net of ['/proc/net/tcp', '/proc/net/tcp6']) {
  if (!existsSync(net)) continue;
  for (const line of readFileSync(net, 'utf8').trim().split(/\n/).slice(1)) {
    const cols = line.trim().split(/\s+/);
    if (socketInodes.has(cols[9]) && cols[3] !== '0A') {
      console.log(JSON.stringify({ refusal: { code: 'node-active-tcp-session-unsupported', message: 'Active TCP/TLS sessions are not portable in the Node HTTP subset yet' } }));
      process.exit(0);
    }
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
  refusals: [],
  appTarBase64
};
console.log(JSON.stringify(out));
NODE`;
}
