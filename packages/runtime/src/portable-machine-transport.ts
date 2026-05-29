import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { SnapshotError } from "./errors.ts";
import {
  PRODUCT_LEVEL4_PING_SOCKET_MANIFEST,
  createProductLevel4PingSocketSnapshot,
  type ProductLevel4PingSocketCaptureInput,
  type ProductLevel4PingSocketCaptureResult,
} from "./product-level4-ping-socket.ts";
import type { SnapshotResult } from "./vm-handle.ts";
import type { SnapshotContext } from "./vm/snapshot.ts";

export const PORTABLE_MACHINE_TRANSPORT_MANIFEST = "portable-machine-transport.json" as const;
export const PORTABLE_MACHINE_PING_GUEST_DESCRIPTOR_PATHS = [
  "/run/machinen/portable-ping-socket.json",
  "/tmp/machinen-portable-ping-socket.json",
] as const;

interface PortableMachineTransportManifest {
  kind: "machinen.portable-machine-transport";
  formatVersion: 1;
  profile: "ping-level4-socket-reconstruction-v1";
  productSupport: "supported";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  transport: "machinen snapshot";
  restoreSurface: "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]";
  resourceDescriptor: typeof PRODUCT_LEVEL4_PING_SOCKET_MANIFEST;
  reusableResourceModel: {
    family: "level4-kernel-resource-reconstruction";
    firstResource: "network-ping-socket";
    nextResources: ["pipe", "eventfd", "timerfd", "tcp-listener"];
  };
}

type PortableMachinePingGuestDescriptor = Omit<
  ProductLevel4PingSocketCaptureInput,
  "outDir" | "route" | "namespace" | "sourceVerifierOutput"
> & {
  profile?: "ping-level4-socket-reconstruction-v1";
  sourceVerifierOutput: string;
  route?: "loopback";
  namespace?: "target-loopback";
};

export async function snapshotPortableMachinePingWorkload(
  ctx: SnapshotContext,
  outDir: string,
): Promise<SnapshotResult> {
  const started = Date.now();
  const snapDir = resolve(outDir);
  const probe = await probePortableMachinePingDescriptor(ctx);
  const descriptor = parsePortableMachinePingDescriptor(probe.stdout);
  const result = createProductLevel4PingSocketSnapshot({
    ...descriptor,
    outDir: snapDir,
    route: descriptor.route ?? "loopback",
    namespace: descriptor.namespace ?? "target-loopback",
  });
  writePortableMachineDocuments(snapDir, descriptor, result);
  if (result.state === "refused") {
    throw new SnapshotError(
      "SNAPSHOT_PORTABLE_REFUSED",
      `vm.snapshot: portable ping machine refused: ${result.refusal.expectedRefusalCode}`,
    );
  }
  return {
    engine: "portable",
    snapDir,
    elapsedMs: Date.now() - started,
    consoleLog: await ctx.errorOutput(),
  };
}

async function probePortableMachinePingDescriptor(
  ctx: SnapshotContext,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const descriptorProbe = await ctx.execRaw(readExistingPingDescriptorCommand());
  if (descriptorProbe.exitCode === 0) {
    return descriptorProbe;
  }
  const autoProbe = await ctx.execRaw(
    autoInspectPingDescriptorCommand(portableTargetArchOverride()),
  );
  if (autoProbe.exitCode === 0) {
    return autoProbe;
  }
  throw new SnapshotError(
    "SNAPSHOT_PORTABLE_REFUSED",
    "vm.snapshot: portable machine snapshot supports only the ping Level 4 workload subset today. " +
      "Run a single loopback ping process with empty queues/no active recvmsg, or write one of " +
      `${PORTABLE_MACHINE_PING_GUEST_DESCRIPTOR_PATHS.join(", ")} in the guest. ` +
      `Auto-inspection failed: ${autoProbe.stderr.trim() || descriptorProbe.stderr.trim()}`,
  );
}

function readExistingPingDescriptorCommand(): string {
  return [
    "for p in /run/machinen/portable-ping-socket.json /tmp/machinen-portable-ping-socket.json; do",
    '  if [ -f "$p" ]; then cat "$p"; exit 0; fi;',
    "done;",
    "echo 'portable ping descriptor not found' >&2;",
    "exit 2",
  ].join(" ");
}

function portableTargetArchOverride(): "arm64" | "amd64" | undefined {
  const value = process.env.MACHINEN_PORTABLE_TARGET_ARCH;
  return value === "arm64" || value === "amd64" ? value : undefined;
}

function autoInspectPingDescriptorCommand(targetArch: "arm64" | "amd64" | undefined): string {
  const targetAssignment = targetArch ? `target=${targetArch}` : "target=";
  return String.raw`set -eu
${targetAssignment}
arch=$(uname -m)
case "$arch" in aarch64|arm64) source=arm64 ;; x86_64|amd64) source=amd64 ;; *) echo "unsupported guest arch: $arch" >&2; exit 3 ;; esac
if [ -z "$target" ]; then case "$source" in arm64) target=amd64 ;; amd64) target=arm64 ;; esac; fi
pids=""
for d in /proc/[0-9]*; do
  [ -d "$d" ] || continue
  comm=$(cat "$d/comm" 2>/dev/null || true)
  cmdline=$(tr '\000' ' ' < "$d/cmdline" 2>/dev/null || true)
  case "$comm" in ping) pids="$pids ${"$"}{d#/proc/}" ;; esac
done
set -- $pids
if [ "$#" -ne 1 ]; then echo "expected exactly one ping process, found $#" >&2; exit 4; fi
pid=$1
cmd=$(tr '\000' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
case "$cmd" in *127.0.0.1*|*localhost*) ;; *) echo "only loopback ping is supported: $cmd" >&2; exit 5 ;; esac
interval_ms=1000
prev=""
for arg in $cmd; do
  if [ "$prev" = "-i" ]; then interval_ms=$(awk -v s="$arg" 'BEGIN { printf "%d", s * 1000 }'); fi
  case "$arg" in -i*) v=${"$"}{arg#-i}; if [ -n "$v" ]; then interval_ms=$(awk -v s="$v" 'BEGIN { printf "%d", s * 1000 }'); fi ;; esac
  prev="$arg"
done
wchan=$(cat "/proc/$pid/wchan" 2>/dev/null || true)
case "$wchan" in *recv*|*sk_wait_data*|*skb_recv*) echo "active recvmsg ping state is unsupported: $wchan" >&2; exit 6 ;; esac
inodes=""
for fd in /proc/$pid/fd/*; do
  link=$(readlink "$fd" 2>/dev/null || true)
  case "$link" in socket:\[*\]) inode=${"$"}{link#socket:[}; inode=${"$"}{inode%]}; inodes="$inodes $inode" ;; esac
done
[ -n "$inodes" ] || { echo "ping process has no socket fd" >&2; exit 7; }
for inode in $inodes; do
  line=$(awk -v inode="$inode" 'NR>1 { for (i=1; i<=NF; i++) if ($i == inode) { print; exit } }' /proc/net/icmp 2>/dev/null || true)
  if [ -n "$line" ]; then
    local_addr=$(printf '%s\n' "$line" | awk '{print $2}')
    queues=$(printf '%s\n' "$line" | awk '{print $5}')
    [ "$queues" = "00000000:00000000" ] || { echo "ping socket queues are not empty: $queues" >&2; exit 8; }
    id_hex=${"$"}{local_addr#*:}
    id=$(printf '%d' "0x$id_hex")
    seq=1
    printf '{"profile":"ping-level4-socket-reconstruction-v1","sourceArch":"%s","targetArch":"%s","socketKind":"ping-dgram-icmp","sourceVerifierOutput":"ping-dgram-icmp id=%s seq=%s loopback target-loopback","echoIdentifier":%s,"echoSequence":%s,"destination":"127.0.0.1","intervalMs":%s}\n' "$source" "$target" "$id" "$seq" "$id" "$seq" "$interval_ms"
    exit 0
  fi
done
for inode in $inodes; do
  line=$(awk -v inode="$inode" 'NR>1 { for (i=1; i<=NF; i++) if ($i == inode) { print; exit } }' /proc/net/raw 2>/dev/null || true)
  if [ -n "$line" ]; then
    queues=$(printf '%s\n' "$line" | awk '{print $5}')
    [ "$queues" = "00000000:00000000" ] || { echo "raw ICMP socket queues are not empty: $queues" >&2; exit 9; }
    printf '{"profile":"ping-level4-socket-reconstruction-v1","sourceArch":"%s","targetArch":"%s","socketKind":"raw-icmp","sourceVerifierOutput":"raw-icmp id=0 seq=1 loopback target-loopback","echoIdentifier":0,"echoSequence":1,"destination":"127.0.0.1","intervalMs":%s}\n' "$source" "$target" "$interval_ms"
    exit 0
  fi
done
echo "no ping/raw ICMP socket belonging to ping process was found" >&2
exit 10`;
}

function parsePortableMachinePingDescriptor(stdout: string): PortableMachinePingGuestDescriptor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (err) {
    throw new SnapshotError(
      "SNAPSHOT_PORTABLE_REFUSED",
      `vm.snapshot: portable ping descriptor is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(parsed)) {
    throw new SnapshotError(
      "SNAPSHOT_PORTABLE_REFUSED",
      "portable ping descriptor must be an object",
    );
  }
  if (parsed.profile !== undefined && parsed.profile !== "ping-level4-socket-reconstruction-v1") {
    throw new SnapshotError(
      "SNAPSHOT_PORTABLE_REFUSED",
      "portable ping descriptor profile must be ping-level4-socket-reconstruction-v1",
    );
  }
  return {
    profile: "ping-level4-socket-reconstruction-v1",
    sourceArch: parseArch(parsed.sourceArch, "sourceArch"),
    targetArch: parseArch(parsed.targetArch, "targetArch"),
    socketKind: parseSocketKind(parsed.socketKind),
    sourceVerifierOutput: parseString(parsed.sourceVerifierOutput, "sourceVerifierOutput"),
    echoIdentifier: parseUint16(parsed.echoIdentifier, "echoIdentifier"),
    echoSequence: parseUint16(parsed.echoSequence, "echoSequence"),
    destination: "127.0.0.1",
    intervalMs: parseOptionalPositiveInteger(parsed.intervalMs, "intervalMs") ?? 1000,
    outputLogPath: "/tmp/machinen-restored-ping.log",
    sequencePolicy: "continue-at-next-supported-boundary",
    route: "loopback",
    namespace: "target-loopback",
    activeRecvmsg: parsed.activeRecvmsg === true,
    unreadReceiveQueue: parsed.unreadReceiveQueue === true,
    inflightPackets: parsed.inflightPackets === true,
    ambiguousRouteOrNamespace: parsed.ambiguousRouteOrNamespace === true,
    missingCredentialOrCapability: parsed.missingCredentialOrCapability === true,
    unsupportedRawSocketOption: parsed.unsupportedRawSocketOption === true,
  };
}

function writePortableMachineDocuments(
  snapDir: string,
  descriptor: PortableMachinePingGuestDescriptor,
  result: ProductLevel4PingSocketCaptureResult,
): void {
  mkdirSync(join(snapDir, "logs"), { recursive: true });
  writeFileSync(join(snapDir, "memory.bin"), Buffer.alloc(0));
  writeJson(join(snapDir, PORTABLE_MACHINE_TRANSPORT_MANIFEST), transportManifest());
  writeJson(join(snapDir, "manifest.json"), portableManifest(descriptor));
  writeJson(join(snapDir, "objects.json"), {
    formatVersion: 1,
    objects: [],
    unsupported: unsupported(),
  });
  writeJson(join(snapDir, "relocations.json"), {
    formatVersion: 1,
    relocations: [],
    unsupported: unsupported(),
  });
  writeJson(join(snapDir, "resources.json"), portableResources(descriptor, result));
}

function transportManifest(): PortableMachineTransportManifest {
  return {
    kind: "machinen.portable-machine-transport",
    formatVersion: 1,
    profile: "ping-level4-socket-reconstruction-v1",
    productSupport: "supported",
    implementationLevel: "level-4-kernel-resource-reconstruction",
    transport: "machinen snapshot",
    restoreSurface:
      "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]",
    resourceDescriptor: PRODUCT_LEVEL4_PING_SOCKET_MANIFEST,
    reusableResourceModel: {
      family: "level4-kernel-resource-reconstruction",
      firstResource: "network-ping-socket",
      nextResources: ["pipe", "eventfd", "timerfd", "tcp-listener"],
    },
  };
}

function portableManifest(descriptor: PortableMachinePingGuestDescriptor): unknown {
  return {
    formatVersion: 1,
    sourceGuestArch: descriptor.sourceArch,
    allowedTargetGuestArchs: [descriptor.targetArch],
    program: {
      name: "ping-level4-machine-workload",
      executable: "/bin/ping",
      identity: "ping-level4-socket-reconstruction-v1",
    },
    sourceBuild: { buildId: "0123456789abcdef", version: "ping-level4-machine-v1" },
    targetBuild: { version: "target-native-ping" },
    checkpointAbi: {
      version: 1,
      checkpointFunction: { name: "machinen_checkpoint" },
      rootsType: "machinen_checkpoint_roots",
      restoreBundleType: "machinen_restore_bundle",
      safePoint: {
        outsideSignalHandlers: true,
        outsideSyscalls: true,
      },
    },
    checkpointContinuation: { name: "machinen_level4_ping_checkpoint" },
    restoreEntrypoint: { name: "machinen_level4_ping_restore" },
    process: {
      argv: ["/bin/ping", "127.0.0.1"],
      env: { MACHINEN_PORTABLE_MACHINE_PROFILE: "ping-level4-socket-reconstruction-v1" },
      cwd: "/",
    },
    features: [
      "portable-machine-transport",
      "level4-kernel-resource-reconstruction",
      "network-ping-socket",
      "target-vm-continuation",
    ],
    unsupported: unsupported(),
  };
}

function portableResources(
  descriptor: PortableMachinePingGuestDescriptor,
  result: ProductLevel4PingSocketCaptureResult,
): unknown {
  const socketState = result.state === "completed" ? "captured" : "refused";
  return {
    formatVersion: 1,
    resources: [
      { id: "argv", kind: "argv", state: "captured", argv: ["ping", "127.0.0.1"] },
      { id: "cwd", kind: "cwd", state: "captured", path: "/" },
      {
        id: "ping-socket-fd",
        kind: "socket",
        state: socketState,
        fd: 3,
        flags: [
          "profile:ping-level4-socket-reconstruction-v1",
          `socket-kind:${descriptor.socketKind}`,
          `echo-id:${descriptor.echoIdentifier}`,
          `echo-seq:${descriptor.echoSequence}`,
          `destination:${descriptor.destination ?? "127.0.0.1"}`,
          `interval-ms:${descriptor.intervalMs ?? 1000}`,
          "route:loopback",
          "namespace:target-loopback",
          `descriptor:${PRODUCT_LEVEL4_PING_SOCKET_MANIFEST}`,
        ],
        ...(result.state === "refused"
          ? {
              refusal: {
                code: "resource-unsupported",
                message: result.refusal.message,
                detail: { expectedRefusalCode: result.refusal.expectedRefusalCode },
              },
            }
          : {}),
      },
    ],
    unsupported:
      result.state === "completed"
        ? unsupported()
        : {
            vocabularyVersion: 1,
            refusals: [
              {
                code: "resource-unsupported",
                message: result.refusal.message,
                detail: { expectedRefusalCode: result.refusal.expectedRefusalCode },
              },
            ],
          },
  };
}

function unsupported(): { vocabularyVersion: 1; refusals: [] } {
  return { vocabularyVersion: 1, refusals: [] };
}

function parseArch(value: unknown, field: string): "arm64" | "amd64" {
  if (value === "arm64" || value === "amd64") {
    return value;
  }
  throw new SnapshotError("SNAPSHOT_PORTABLE_REFUSED", `${field} must be arm64 or amd64`);
}

function parseSocketKind(value: unknown): "ping-dgram-icmp" | "raw-icmp" {
  if (value === "ping-dgram-icmp" || value === "raw-icmp") {
    return value;
  }
  throw new SnapshotError(
    "SNAPSHOT_PORTABLE_REFUSED",
    "socketKind must be ping-dgram-icmp or raw-icmp",
  );
}

function parseString(value: unknown, field: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new SnapshotError("SNAPSHOT_PORTABLE_REFUSED", `${field} must be a non-empty string`);
}

function parseUint16(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 65535) {
    return value;
  }
  throw new SnapshotError(
    "SNAPSHOT_PORTABLE_REFUSED",
    `${field} must be an integer between 0 and 65535`,
  );
}

function parseOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  throw new SnapshotError("SNAPSHOT_PORTABLE_REFUSED", `${field} must be a positive integer`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
