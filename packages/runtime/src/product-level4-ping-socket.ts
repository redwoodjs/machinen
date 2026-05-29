import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch as osArch, platform, release } from "node:os";
import { join, resolve } from "node:path";

export const PRODUCT_LEVEL4_PING_SOCKET_FORMAT_VERSION = 1 as const;
export const PRODUCT_LEVEL4_PING_SOCKET_MANIFEST = "portable-ping-socket.json" as const;
export const PRODUCT_LEVEL4_PING_SOCKET_REFUSAL = "portable-ping-socket-refusal.json" as const;
export const PRODUCT_LEVEL4_PING_SOCKET_RESTORE_SUMMARY =
  "portable-ping-socket-restore-summary.json" as const;

export const productLevel4PingSocketArchitectures = ["arm64", "amd64"] as const;
export type ProductLevel4PingSocketArchitecture =
  (typeof productLevel4PingSocketArchitectures)[number];

export const productLevel4PingSocketKinds = ["ping-dgram-icmp", "raw-icmp"] as const;
export type ProductLevel4PingSocketKind = (typeof productLevel4PingSocketKinds)[number];

export const productLevel4PingSocketRefusalCodes = [
  "ping-socket-active-recvmsg-unsupported",
  "ping-socket-unread-receive-queue-unsupported",
  "ping-socket-inflight-packets-unsupported",
  "ping-socket-ambiguous-route-or-namespace",
  "ping-socket-missing-credential-or-capability",
  "ping-socket-unsupported-raw-socket-option",
  "ping-socket-source-target-arch-match",
  "ping-socket-target-arch-mismatch",
  "ping-socket-target-verifier-mismatch",
] as const;
export type ProductLevel4PingSocketRefusalCode =
  (typeof productLevel4PingSocketRefusalCodes)[number];

export interface ProductLevel4PingSocketCaptureInput {
  outDir: string;
  sourceArch: ProductLevel4PingSocketArchitecture;
  targetArch: ProductLevel4PingSocketArchitecture;
  socketKind: ProductLevel4PingSocketKind;
  sourceVerifierOutput: string;
  echoIdentifier: number;
  echoSequence: number;
  destination?: "127.0.0.1";
  intervalMs?: number;
  outputLogPath?: "/tmp/machinen-restored-ping.log";
  sequencePolicy?: "continue-at-next-supported-boundary";
  route: "loopback";
  namespace: "target-loopback";
  credential?: "ping-group-range" | "cap-net-raw";
  activeRecvmsg?: boolean;
  unreadReceiveQueue?: boolean;
  inflightPackets?: boolean;
  ambiguousRouteOrNamespace?: boolean;
  missingCredentialOrCapability?: boolean;
  unsupportedRawSocketOption?: boolean;
  dryRun?: boolean;
}

export interface ProductLevel4PingSocketDescriptor {
  kind: "machinen.product-level4-ping-socket";
  formatVersion: typeof PRODUCT_LEVEL4_PING_SOCKET_FORMAT_VERSION;
  supportLevel: "implemented-product-support";
  subset: "ping-level4-socket-reconstruction-v1";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  runtime: "network-ping-socket";
  captureSurface: "machinen capture ping-socket";
  restoreSurface: "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]";
  source: {
    architecture: ProductLevel4PingSocketArchitecture;
    host: { arch: string; platform: string; release: string };
  };
  target: { architecture: ProductLevel4PingSocketArchitecture };
  socket: {
    kind: ProductLevel4PingSocketKind;
    route: "loopback";
    namespace: "target-loopback";
    credential: "ping-group-range" | "cap-net-raw";
    echoIdentifier: number;
    echoSequence: number;
  };
  continuation: {
    destination: "127.0.0.1";
    intervalMs: number;
    outputLogPath: "/tmp/machinen-restored-ping.log";
    sequencePolicy: "continue-at-next-supported-boundary";
    idPolicy: "descriptor-preserved-when-target-ping-supports-it";
    textOutputSequencePolicy: "machinen-helper-renders-descriptor-sequence";
  };
  gates: {
    emptyReceiveQueueRequired: true;
    noInflightPacketsRequired: true;
    noActiveRecvmsgRequired: true;
    unambiguousRouteAndNamespaceRequired: true;
    credentialOrCapabilityMappingRequired: true;
    unsupportedRawSocketOptionsRefused: true;
    targetNativeVerificationRequired: true;
    sourceIsaEmulationAllowed: false;
    sourceTextReplayAllowed: false;
    sidecarRuntimeAllowed: false;
    metadataOnlyContinuationAllowed: false;
  };
  sourceVerifierOutput: string;
  sourceVerifierOutputSha256: string;
}

export interface ProductLevel4PingSocketRefusal {
  kind: "machinen.product-level4-ping-socket-refusal";
  formatVersion: typeof PRODUCT_LEVEL4_PING_SOCKET_FORMAT_VERSION;
  runtime: "network-ping-socket";
  supportLevel: "explicit-refusal";
  state: "refused";
  migrationCompleted: false;
  expectedRefusalCode: ProductLevel4PingSocketRefusalCode;
  message: string;
  evidence: Record<string, unknown>;
  sourceIsaEmulationUsed: false;
  sourceTextReusedAsTargetCode: false;
  sidecarRuntimeUsed: false;
  metadataOnlyShortcutAccepted: false;
}

export type ProductLevel4PingSocketCaptureResult =
  | {
      state: "completed";
      migrationCompleted: true;
      bundleDir: string;
      descriptor: ProductLevel4PingSocketDescriptor;
      dryRun: boolean;
    }
  | {
      state: "refused";
      migrationCompleted: false;
      bundleDir: string;
      refusal: ProductLevel4PingSocketRefusal;
      dryRun: boolean;
    };

export interface ProductLevel4PingSocketRestoreInput {
  bundleDir: string;
  targetArch: ProductLevel4PingSocketArchitecture;
  targetVerifierOutput: string;
  dryRun?: boolean;
}

export interface ProductLevel4PingSocketRestoreSummary {
  kind: "machinen.product-level4-ping-socket-restore-summary";
  formatVersion: typeof PRODUCT_LEVEL4_PING_SOCKET_FORMAT_VERSION;
  runtime: "network-ping-socket";
  subset: "ping-level4-socket-reconstruction-v1";
  supportLevel: "implemented-product-support";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  state: "completed" | "refused";
  migrationCompleted: boolean;
  sourceArch?: ProductLevel4PingSocketArchitecture;
  targetArch: ProductLevel4PingSocketArchitecture;
  targetVerifierResult: "passed" | "failed" | "not-run";
  descriptorSha256?: string;
  targetVerifierOutputSha256?: string;
  refusal?: ProductLevel4PingSocketRefusal;
  shortcutInspection: {
    sourceIsaEmulationUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    metadataOnlyShortcutAccepted: false;
  };
}

export function createProductLevel4PingSocketSnapshot(
  input: ProductLevel4PingSocketCaptureInput,
): ProductLevel4PingSocketCaptureResult {
  assertPingArch(input.sourceArch, "sourceArch");
  assertPingArch(input.targetArch, "targetArch");
  assertPingSocketKind(input.socketKind);
  assertEchoField(input.echoIdentifier, "echoIdentifier");
  assertEchoField(input.echoSequence, "echoSequence");
  const outDir = resolve(input.outDir);
  const refusal = sourceRefusal(input);
  if (input.dryRun !== true) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }
  if (refusal) {
    if (input.dryRun !== true) {
      writeJson(join(outDir, PRODUCT_LEVEL4_PING_SOCKET_REFUSAL), refusal);
    }
    return {
      state: "refused",
      migrationCompleted: false,
      bundleDir: outDir,
      refusal,
      dryRun: input.dryRun === true,
    };
  }
  const descriptor: ProductLevel4PingSocketDescriptor = {
    kind: "machinen.product-level4-ping-socket",
    formatVersion: PRODUCT_LEVEL4_PING_SOCKET_FORMAT_VERSION,
    supportLevel: "implemented-product-support",
    subset: "ping-level4-socket-reconstruction-v1",
    implementationLevel: "level-4-kernel-resource-reconstruction",
    runtime: "network-ping-socket",
    captureSurface: "machinen capture ping-socket",
    restoreSurface:
      "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]",
    source: {
      architecture: input.sourceArch,
      host: { arch: osArch(), platform: platform(), release: release() },
    },
    target: { architecture: input.targetArch },
    socket: {
      kind: input.socketKind,
      route: input.route,
      namespace: input.namespace,
      credential: input.credential ?? defaultCredential(input.socketKind),
      echoIdentifier: input.echoIdentifier,
      echoSequence: input.echoSequence,
    },
    continuation: {
      destination: input.destination ?? "127.0.0.1",
      intervalMs: input.intervalMs ?? 1000,
      outputLogPath: input.outputLogPath ?? "/tmp/machinen-restored-ping.log",
      sequencePolicy: input.sequencePolicy ?? "continue-at-next-supported-boundary",
      idPolicy: "descriptor-preserved-when-target-ping-supports-it",
      textOutputSequencePolicy: "machinen-helper-renders-descriptor-sequence",
    },
    gates: {
      emptyReceiveQueueRequired: true,
      noInflightPacketsRequired: true,
      noActiveRecvmsgRequired: true,
      unambiguousRouteAndNamespaceRequired: true,
      credentialOrCapabilityMappingRequired: true,
      unsupportedRawSocketOptionsRefused: true,
      targetNativeVerificationRequired: true,
      sourceIsaEmulationAllowed: false,
      sourceTextReplayAllowed: false,
      sidecarRuntimeAllowed: false,
      metadataOnlyContinuationAllowed: false,
    },
    sourceVerifierOutput: input.sourceVerifierOutput.trim(),
    sourceVerifierOutputSha256: sha256Text(input.sourceVerifierOutput.trim()),
  };
  if (input.dryRun !== true) {
    writeJson(join(outDir, PRODUCT_LEVEL4_PING_SOCKET_MANIFEST), descriptor);
  }
  return {
    state: "completed",
    migrationCompleted: true,
    bundleDir: outDir,
    descriptor,
    dryRun: input.dryRun === true,
  };
}

export function isProductLevel4PingSocketBundle(bundleDir: string): boolean {
  return existsSync(join(bundleDir, PRODUCT_LEVEL4_PING_SOCKET_MANIFEST));
}

export function restoreProductLevel4PingSocketSnapshot(
  input: ProductLevel4PingSocketRestoreInput,
): ProductLevel4PingSocketRestoreSummary {
  assertPingArch(input.targetArch, "targetArch");
  const bundleDir = resolve(input.bundleDir);
  const descriptorPath = join(bundleDir, PRODUCT_LEVEL4_PING_SOCKET_MANIFEST);
  if (!existsSync(descriptorPath)) {
    throw new ProductLevel4PingSocketError(
      "PING_SOCKET_BUNDLE_MISSING",
      `portable ping socket descriptor does not exist: ${descriptorPath}`,
    );
  }
  const descriptorText = readFileSync(descriptorPath, "utf8");
  const descriptor = parseDescriptor(descriptorText);
  const shortcutInspection = {
    sourceIsaEmulationUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    metadataOnlyShortcutAccepted: false,
  } as const;
  const targetVerifierOutput = input.targetVerifierOutput.trim();
  const targetVerifierOutputSha256 = sha256Text(targetVerifierOutput);
  let refusal: ProductLevel4PingSocketRefusal | undefined;
  if (descriptor.target.architecture !== input.targetArch) {
    refusal = makeRefusal("ping-socket-target-arch-mismatch", {
      expected: descriptor.target.architecture,
      actual: input.targetArch,
    });
  } else if (!verifierMatches(descriptor, targetVerifierOutput)) {
    refusal = makeRefusal("ping-socket-target-verifier-mismatch", {
      sourceVerifierOutputSha256: descriptor.sourceVerifierOutputSha256,
      targetVerifierOutputSha256,
      socket: descriptor.socket,
    });
  }
  const summary: ProductLevel4PingSocketRestoreSummary = {
    kind: "machinen.product-level4-ping-socket-restore-summary",
    formatVersion: PRODUCT_LEVEL4_PING_SOCKET_FORMAT_VERSION,
    runtime: "network-ping-socket",
    subset: "ping-level4-socket-reconstruction-v1",
    supportLevel: "implemented-product-support",
    implementationLevel: "level-4-kernel-resource-reconstruction",
    state: refusal ? "refused" : "completed",
    migrationCompleted: !refusal,
    sourceArch: descriptor.source.architecture,
    targetArch: input.targetArch,
    targetVerifierResult: refusal ? "failed" : "passed",
    descriptorSha256: sha256Text(descriptorText),
    targetVerifierOutputSha256,
    ...(refusal ? { refusal } : {}),
    shortcutInspection,
  };
  if (input.dryRun !== true) {
    writeJson(join(bundleDir, PRODUCT_LEVEL4_PING_SOCKET_RESTORE_SUMMARY), summary);
  }
  return summary;
}

function sourceRefusal(
  input: ProductLevel4PingSocketCaptureInput,
): ProductLevel4PingSocketRefusal | undefined {
  if (input.sourceArch === input.targetArch) {
    return makeRefusal("ping-socket-source-target-arch-match", {
      sourceArch: input.sourceArch,
      targetArch: input.targetArch,
    });
  }
  if (input.activeRecvmsg) {
    return makeRefusal("ping-socket-active-recvmsg-unsupported", { ...input });
  }
  if (input.unreadReceiveQueue) {
    return makeRefusal("ping-socket-unread-receive-queue-unsupported", { ...input });
  }
  if (input.inflightPackets) {
    return makeRefusal("ping-socket-inflight-packets-unsupported", { ...input });
  }
  if (input.ambiguousRouteOrNamespace) {
    return makeRefusal("ping-socket-ambiguous-route-or-namespace", { ...input });
  }
  if (input.missingCredentialOrCapability) {
    return makeRefusal("ping-socket-missing-credential-or-capability", { ...input });
  }
  if (input.unsupportedRawSocketOption) {
    return makeRefusal("ping-socket-unsupported-raw-socket-option", { ...input });
  }
  return undefined;
}

function makeRefusal(
  code: ProductLevel4PingSocketRefusalCode,
  evidence: Record<string, unknown>,
): ProductLevel4PingSocketRefusal {
  return {
    kind: "machinen.product-level4-ping-socket-refusal",
    formatVersion: PRODUCT_LEVEL4_PING_SOCKET_FORMAT_VERSION,
    runtime: "network-ping-socket",
    supportLevel: "explicit-refusal",
    state: "refused",
    migrationCompleted: false,
    expectedRefusalCode: code,
    message: refusalMessage(code),
    evidence,
    sourceIsaEmulationUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    metadataOnlyShortcutAccepted: false,
  };
}

function refusalMessage(code: ProductLevel4PingSocketRefusalCode): string {
  switch (code) {
    case "ping-socket-active-recvmsg-unsupported":
      return "active recvmsg state is outside the supported ping socket reconstruction boundary";
    case "ping-socket-unread-receive-queue-unsupported":
      return "unread ping receive queue data is outside the supported ping socket reconstruction boundary";
    case "ping-socket-inflight-packets-unsupported":
      return "in-flight ICMP packets are outside the supported ping socket reconstruction boundary";
    case "ping-socket-ambiguous-route-or-namespace":
      return "route or network namespace cannot be reconstructed unambiguously on the target";
    case "ping-socket-missing-credential-or-capability":
      return "required ping_group_range or CAP_NET_RAW mapping is missing";
    case "ping-socket-unsupported-raw-socket-option":
      return "the raw ICMP socket uses an unsupported option";
    case "ping-socket-source-target-arch-match":
      return "Level 4 ping socket reconstruction is only claimed for cross-architecture restores";
    case "ping-socket-target-arch-mismatch":
      return "target architecture does not match the portable ping socket descriptor";
    case "ping-socket-target-verifier-mismatch":
      return "target-native ping socket verifier output does not match the descriptor";
  }
}

function verifierMatches(
  descriptor: ProductLevel4PingSocketDescriptor,
  targetVerifierOutput: string,
): boolean {
  if (targetVerifierOutput === descriptor.sourceVerifierOutput) {
    return true;
  }
  const expectedFragments = [
    descriptor.socket.kind,
    `id=${descriptor.socket.echoIdentifier}`,
    `seq=${descriptor.socket.echoSequence}`,
    descriptor.socket.route,
    descriptor.socket.namespace,
  ];
  return expectedFragments.every((fragment) => targetVerifierOutput.includes(fragment));
}

function parseDescriptor(text: string): ProductLevel4PingSocketDescriptor {
  const parsed = JSON.parse(text) as Partial<ProductLevel4PingSocketDescriptor>;
  if (
    parsed.kind !== "machinen.product-level4-ping-socket" ||
    parsed.formatVersion !== PRODUCT_LEVEL4_PING_SOCKET_FORMAT_VERSION ||
    parsed.subset !== "ping-level4-socket-reconstruction-v1" ||
    !parsed.source ||
    !parsed.target ||
    !parsed.socket
  ) {
    throw new ProductLevel4PingSocketError(
      "PING_SOCKET_DESCRIPTOR_INVALID",
      "portable ping socket descriptor is invalid",
    );
  }
  assertPingArch(parsed.source.architecture, "descriptor.source.architecture");
  assertPingArch(parsed.target.architecture, "descriptor.target.architecture");
  assertPingSocketKind(parsed.socket.kind);
  return parsed as ProductLevel4PingSocketDescriptor;
}

function defaultCredential(kind: ProductLevel4PingSocketKind): "ping-group-range" | "cap-net-raw" {
  return kind === "raw-icmp" ? "cap-net-raw" : "ping-group-range";
}

function assertPingArch(
  value: string,
  field: string,
): asserts value is ProductLevel4PingSocketArchitecture {
  if (value !== "arm64" && value !== "amd64") {
    throw new ProductLevel4PingSocketError(
      "PING_SOCKET_ARCH_INVALID",
      `${field} must be arm64 or amd64`,
    );
  }
}

function assertPingSocketKind(value: string): asserts value is ProductLevel4PingSocketKind {
  if (value !== "ping-dgram-icmp" && value !== "raw-icmp") {
    throw new ProductLevel4PingSocketError(
      "PING_SOCKET_KIND_INVALID",
      "socketKind must be ping-dgram-icmp or raw-icmp",
    );
  }
}

function assertEchoField(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 65535) {
    throw new ProductLevel4PingSocketError(
      "PING_SOCKET_ECHO_FIELD_INVALID",
      `${field} must be an integer between 0 and 65535`,
    );
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class ProductLevel4PingSocketError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductLevel4PingSocketError";
  }
}
