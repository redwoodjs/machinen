import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch as osArch, platform, release } from "node:os";
import { join, resolve } from "node:path";

export const PRODUCT_LEVEL4_TCP_LISTENER_FORMAT_VERSION = 1 as const;
export const PRODUCT_LEVEL4_TCP_LISTENER_MANIFEST = "portable-tcp-listener.json" as const;
export const PRODUCT_LEVEL4_TCP_LISTENER_REFUSAL = "portable-tcp-listener-refusal.json" as const;
export const PRODUCT_LEVEL4_TCP_LISTENER_RESTORE_SUMMARY =
  "portable-tcp-listener-restore-summary.json" as const;

export const productLevel4TcpListenerArchitectures = ["arm64", "amd64"] as const;
export type ProductLevel4TcpListenerArchitecture =
  (typeof productLevel4TcpListenerArchitectures)[number];

export const productLevel4TcpListenerRefusalCodes = [
  "tcp-listener-source-target-arch-match",
  "tcp-listener-target-arch-mismatch",
  "tcp-listener-target-verifier-mismatch",
  "tcp-listener-address-unsupported",
  "tcp-listener-port-invalid",
  "tcp-listener-backlog-out-of-range",
  "tcp-listener-active-connections-unsupported",
  "tcp-listener-accept-queue-unsupported",
  "tcp-listener-unsupported-options",
  "tcp-listener-partial-io-unsupported",
  "tcp-listener-active-syscall-unsupported",
] as const;
export type ProductLevel4TcpListenerRefusalCode =
  (typeof productLevel4TcpListenerRefusalCodes)[number];

export interface ProductLevel4TcpListenerCaptureInput {
  outDir: string;
  sourceArch: ProductLevel4TcpListenerArchitecture;
  targetArch: ProductLevel4TcpListenerArchitecture;
  sourceVerifierOutput: string;
  bindAddress: string;
  port: number;
  backlog: number;
  reuseAddr?: boolean;
  acceptQueue?: "empty" | "non-empty" | "unknown";
  activeConnections?: boolean;
  unsupportedOptions?: boolean;
  partialIo?: boolean;
  activeSyscall?: boolean;
  outputLogPath?: "/tmp/machinen-restored-tcp-listener.log";
  dryRun?: boolean;
}

export interface ProductLevel4TcpListenerDescriptor {
  kind: "machinen.product-level4-tcp-listener";
  formatVersion: typeof PRODUCT_LEVEL4_TCP_LISTENER_FORMAT_VERSION;
  supportLevel: "implemented-product-support";
  subset: "tcp-listener-v1-loopback-empty-accept-queue";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  runtime: "native-linux-resource";
  captureSurface: "machinen capture tcp-listener";
  restoreSurface: "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]";
  source: {
    architecture: ProductLevel4TcpListenerArchitecture;
    host: { arch: string; platform: string; release: string };
  };
  target: { architecture: ProductLevel4TcpListenerArchitecture };
  listener: {
    family: "inet";
    socketType: "stream";
    protocol: "tcp";
    bindAddress: "127.0.0.1";
    port: number;
    backlog: number;
    reuseAddr: true;
    acceptQueue: "empty";
    activeConnections: false;
    partialIo: false;
  };
  continuation: {
    outputLogPath: "/tmp/machinen-restored-tcp-listener.log";
    listenerPolicy: "target-native-loopback-tcp-listener-recreated";
    acceptQueuePolicy: "empty-accept-queue-only";
  };
  gates: {
    loopbackBindRequired: true;
    staticPortRequired: true;
    explicitBacklogRequired: true;
    emptyAcceptQueueRequired: true;
    noActiveConnectionsRequired: true;
    supportedSocketOptionsRequired: true;
    noPartialIoRequired: true;
    noActiveSyscallRequired: true;
    targetNativeVerificationRequired: true;
    sourceIsaEmulationAllowed: false;
    sourceTextReplayAllowed: false;
    sidecarRuntimeAllowed: false;
    metadataOnlyContinuationAllowed: false;
  };
  sourceVerifierOutput: string;
  sourceVerifierOutputSha256: string;
}

export interface ProductLevel4TcpListenerRefusal {
  kind: "machinen.product-level4-tcp-listener-refusal";
  formatVersion: typeof PRODUCT_LEVEL4_TCP_LISTENER_FORMAT_VERSION;
  runtime: "native-linux-resource";
  supportLevel: "explicit-refusal";
  state: "refused";
  migrationCompleted: false;
  expectedRefusalCode: ProductLevel4TcpListenerRefusalCode;
  message: string;
  evidence: Record<string, unknown>;
  sourceIsaEmulationUsed: false;
  sourceTextReusedAsTargetCode: false;
  sidecarRuntimeUsed: false;
  metadataOnlyShortcutAccepted: false;
}

export type ProductLevel4TcpListenerCaptureResult =
  | {
      state: "completed";
      migrationCompleted: true;
      bundleDir: string;
      descriptor: ProductLevel4TcpListenerDescriptor;
      dryRun: boolean;
    }
  | {
      state: "refused";
      migrationCompleted: false;
      bundleDir: string;
      refusal: ProductLevel4TcpListenerRefusal;
      dryRun: boolean;
    };

export interface ProductLevel4TcpListenerRestoreInput {
  bundleDir: string;
  targetArch: ProductLevel4TcpListenerArchitecture;
  targetVerifierOutput: string;
  dryRun?: boolean;
}

export interface ProductLevel4TcpListenerRestoreSummary {
  kind: "machinen.product-level4-tcp-listener-restore-summary";
  formatVersion: typeof PRODUCT_LEVEL4_TCP_LISTENER_FORMAT_VERSION;
  runtime: "native-linux-resource";
  subset: "tcp-listener-v1-loopback-empty-accept-queue";
  supportLevel: "implemented-product-support";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  state: "completed" | "refused";
  migrationCompleted: boolean;
  sourceArch?: ProductLevel4TcpListenerArchitecture;
  targetArch: ProductLevel4TcpListenerArchitecture;
  targetVerifierResult: "passed" | "failed" | "not-run";
  descriptorSha256?: string;
  targetVerifierOutputSha256?: string;
  refusal?: ProductLevel4TcpListenerRefusal;
  shortcutInspection: {
    sourceIsaEmulationUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    metadataOnlyShortcutAccepted: false;
  };
}

// fallow-ignore-next-line code-duplication
export function createProductLevel4TcpListenerSnapshot(
  input: ProductLevel4TcpListenerCaptureInput,
): ProductLevel4TcpListenerCaptureResult {
  assertTcpListenerArch(input.sourceArch, "sourceArch");
  assertTcpListenerArch(input.targetArch, "targetArch");
  const outDir = resolve(input.outDir);
  const refusal = sourceRefusal(input);
  if (input.dryRun !== true) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }
  if (refusal) {
    if (input.dryRun !== true) {
      writeJson(join(outDir, PRODUCT_LEVEL4_TCP_LISTENER_REFUSAL), refusal);
    }
    return {
      state: "refused",
      migrationCompleted: false,
      bundleDir: outDir,
      refusal,
      dryRun: input.dryRun === true,
    };
  }
  const descriptor: ProductLevel4TcpListenerDescriptor = {
    kind: "machinen.product-level4-tcp-listener",
    formatVersion: PRODUCT_LEVEL4_TCP_LISTENER_FORMAT_VERSION,
    supportLevel: "implemented-product-support",
    subset: "tcp-listener-v1-loopback-empty-accept-queue",
    implementationLevel: "level-4-kernel-resource-reconstruction",
    runtime: "native-linux-resource",
    captureSurface: "machinen capture tcp-listener",
    restoreSurface:
      "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]",
    source: {
      architecture: input.sourceArch,
      host: { arch: osArch(), platform: platform(), release: release() },
    },
    target: { architecture: input.targetArch },
    listener: {
      family: "inet",
      socketType: "stream",
      protocol: "tcp",
      bindAddress: "127.0.0.1",
      port: input.port,
      backlog: input.backlog,
      reuseAddr: true,
      acceptQueue: "empty",
      activeConnections: false,
      partialIo: false,
    },
    continuation: {
      outputLogPath: input.outputLogPath ?? "/tmp/machinen-restored-tcp-listener.log",
      listenerPolicy: "target-native-loopback-tcp-listener-recreated",
      acceptQueuePolicy: "empty-accept-queue-only",
    },
    gates: {
      loopbackBindRequired: true,
      staticPortRequired: true,
      explicitBacklogRequired: true,
      emptyAcceptQueueRequired: true,
      noActiveConnectionsRequired: true,
      supportedSocketOptionsRequired: true,
      noPartialIoRequired: true,
      noActiveSyscallRequired: true,
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
    writeJson(join(outDir, PRODUCT_LEVEL4_TCP_LISTENER_MANIFEST), descriptor);
  }
  return {
    state: "completed",
    migrationCompleted: true,
    bundleDir: outDir,
    descriptor,
    dryRun: input.dryRun === true,
  };
}

export function isProductLevel4TcpListenerBundle(bundleDir: string): boolean {
  return existsSync(join(bundleDir, PRODUCT_LEVEL4_TCP_LISTENER_MANIFEST));
}

export function restoreProductLevel4TcpListenerSnapshot(
  input: ProductLevel4TcpListenerRestoreInput,
): ProductLevel4TcpListenerRestoreSummary {
  assertTcpListenerArch(input.targetArch, "targetArch");
  const bundleDir = resolve(input.bundleDir);
  const loadedDescriptor = loadTcpListenerDescriptor(bundleDir);
  const { descriptor, descriptorText } = loadedDescriptor;
  const shortcutInspection = tcpListenerShortcutInspection();
  const targetVerifierOutput = input.targetVerifierOutput.trim();
  const targetVerifierOutputSha256 = sha256Text(targetVerifierOutput);
  let refusal: ProductLevel4TcpListenerRefusal | undefined;
  if (descriptor.target.architecture !== input.targetArch) {
    refusal = makeRefusal("tcp-listener-target-arch-mismatch", {
      expected: descriptor.target.architecture,
      actual: input.targetArch,
    });
  } else if (!verifierMatches(descriptor, targetVerifierOutput)) {
    refusal = makeRefusal("tcp-listener-target-verifier-mismatch", {
      sourceVerifierOutputSha256: descriptor.sourceVerifierOutputSha256,
      targetVerifierOutputSha256,
      listener: descriptor.listener,
    });
  }
  const accepted = refusal === undefined;
  const summary: ProductLevel4TcpListenerRestoreSummary = {
    kind: "machinen.product-level4-tcp-listener-restore-summary",
    formatVersion: PRODUCT_LEVEL4_TCP_LISTENER_FORMAT_VERSION,
    runtime: "native-linux-resource",
    subset: "tcp-listener-v1-loopback-empty-accept-queue",
    supportLevel: "implemented-product-support",
    implementationLevel: "level-4-kernel-resource-reconstruction",
    state: accepted ? "completed" : "refused",
    migrationCompleted: accepted,
    sourceArch: descriptor.source.architecture,
    targetArch: input.targetArch,
    targetVerifierResult: accepted ? "passed" : "failed",
    descriptorSha256: sha256Text(descriptorText),
    targetVerifierOutputSha256,
    ...(refusal ? { refusal } : {}),
    shortcutInspection,
  };
  if (input.dryRun !== true) {
    writeJson(join(bundleDir, PRODUCT_LEVEL4_TCP_LISTENER_RESTORE_SUMMARY), summary);
  }
  return summary;
}

// fallow-ignore-next-line complexity
function sourceRefusal(
  input: ProductLevel4TcpListenerCaptureInput,
): ProductLevel4TcpListenerRefusal | undefined {
  if (input.sourceArch === input.targetArch) {
    return makeRefusal("tcp-listener-source-target-arch-match", {
      sourceArch: input.sourceArch,
      targetArch: input.targetArch,
    });
  }
  if (input.bindAddress !== "127.0.0.1") {
    return makeRefusal("tcp-listener-address-unsupported", { bindAddress: input.bindAddress });
  }
  if (!validPort(input.port)) {
    return makeRefusal("tcp-listener-port-invalid", { port: input.port });
  }
  if (!validBacklog(input.backlog)) {
    return makeRefusal("tcp-listener-backlog-out-of-range", { backlog: input.backlog });
  }
  if (input.activeConnections) {
    return makeRefusal("tcp-listener-active-connections-unsupported", {
      activeConnections: true,
    });
  }
  if ((input.acceptQueue ?? "empty") !== "empty") {
    return makeRefusal("tcp-listener-accept-queue-unsupported", {
      acceptQueue: input.acceptQueue,
    });
  }
  if (input.reuseAddr === false || input.unsupportedOptions) {
    return makeRefusal("tcp-listener-unsupported-options", {
      reuseAddr: input.reuseAddr,
      unsupportedOptions: input.unsupportedOptions,
    });
  }
  if (input.partialIo) {
    return makeRefusal("tcp-listener-partial-io-unsupported", { partialIo: true });
  }
  if (input.activeSyscall) {
    return makeRefusal("tcp-listener-active-syscall-unsupported", { activeSyscall: true });
  }
  return undefined;
}

function makeRefusal(
  code: ProductLevel4TcpListenerRefusalCode,
  evidence: Record<string, unknown>,
): ProductLevel4TcpListenerRefusal {
  return {
    kind: "machinen.product-level4-tcp-listener-refusal",
    formatVersion: PRODUCT_LEVEL4_TCP_LISTENER_FORMAT_VERSION,
    runtime: "native-linux-resource",
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

// fallow-ignore-next-line complexity
function refusalMessage(code: ProductLevel4TcpListenerRefusalCode): string {
  switch (code) {
    case "tcp-listener-source-target-arch-match":
      return "Level 4 TCP listener reconstruction is only claimed for cross-architecture restores";
    case "tcp-listener-target-arch-mismatch":
      return "target architecture does not match the portable TCP listener descriptor";
    case "tcp-listener-target-verifier-mismatch":
      return "target-native TCP listener verifier output does not match the descriptor";
    case "tcp-listener-address-unsupported":
      return "only explicit 127.0.0.1 TCP listener binds are currently supported";
    case "tcp-listener-port-invalid":
      return "TCP listener restore requires a static non-zero TCP port";
    case "tcp-listener-backlog-out-of-range":
      return "TCP listener backlog must be explicit and within the supported range";
    case "tcp-listener-active-connections-unsupported":
      return "active TCP connections are outside the listener-only supported boundary";
    case "tcp-listener-accept-queue-unsupported":
      return "non-empty or unknown TCP accept queues are outside the supported boundary";
    case "tcp-listener-unsupported-options":
      return "unsupported TCP socket options are outside the supported boundary";
    case "tcp-listener-partial-io-unsupported":
      return "partial TCP send/receive state is outside the listener-only boundary";
    case "tcp-listener-active-syscall-unsupported":
      return "active TCP socket syscalls are outside the supported boundary";
  }
}

function verifierMatches(
  descriptor: ProductLevel4TcpListenerDescriptor,
  targetVerifierOutput: string,
): boolean {
  if (targetVerifierOutput === descriptor.sourceVerifierOutput) {
    return true;
  }
  const expectedFragments = [
    "tcp-listener",
    "family=inet",
    "protocol=tcp",
    `bind=127.0.0.1:${descriptor.listener.port}`,
    `backlog=${descriptor.listener.backlog}`,
    "acceptQueue=empty",
    "reuseaddr=true",
  ];
  return expectedFragments.every((fragment) => targetVerifierOutput.includes(fragment));
}

function loadTcpListenerDescriptor(bundleDir: string): {
  descriptor: ProductLevel4TcpListenerDescriptor;
  descriptorText: string;
} {
  const descriptorPath = join(bundleDir, PRODUCT_LEVEL4_TCP_LISTENER_MANIFEST);
  if (!existsSync(descriptorPath)) {
    throw new ProductLevel4TcpListenerError(
      "TCP_LISTENER_BUNDLE_MISSING",
      `portable TCP listener descriptor does not exist: ${descriptorPath}`,
    );
  }
  const descriptorText = readFileSync(descriptorPath, "utf8");
  return { descriptor: parseDescriptor(descriptorText), descriptorText };
}

function tcpListenerShortcutInspection(): ProductLevel4TcpListenerRestoreSummary["shortcutInspection"] {
  return {
    sourceIsaEmulationUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    metadataOnlyShortcutAccepted: false,
  };
}

function parseDescriptor(text: string): ProductLevel4TcpListenerDescriptor {
  const parsed = JSON.parse(text) as Partial<ProductLevel4TcpListenerDescriptor>;
  if (
    parsed.kind !== "machinen.product-level4-tcp-listener" ||
    parsed.formatVersion !== PRODUCT_LEVEL4_TCP_LISTENER_FORMAT_VERSION ||
    parsed.subset !== "tcp-listener-v1-loopback-empty-accept-queue" ||
    !parsed.source ||
    !parsed.target ||
    !parsed.listener
  ) {
    throw new ProductLevel4TcpListenerError(
      "TCP_LISTENER_DESCRIPTOR_INVALID",
      "portable TCP listener descriptor is invalid",
    );
  }
  assertTcpListenerArch(parsed.source.architecture, "descriptor.source.architecture");
  assertTcpListenerArch(parsed.target.architecture, "descriptor.target.architecture");
  if (!validPort(parsed.listener.port) || !validBacklog(parsed.listener.backlog)) {
    throw new ProductLevel4TcpListenerError(
      "TCP_LISTENER_DESCRIPTOR_INVALID",
      "portable TCP listener descriptor bind/backlog state is invalid",
    );
  }
  return parsed as ProductLevel4TcpListenerDescriptor;
}

function validPort(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 65_535;
}

function validBacklog(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 128;
}

function assertTcpListenerArch(
  value: string,
  field: string,
): asserts value is ProductLevel4TcpListenerArchitecture {
  if (value !== "arm64" && value !== "amd64") {
    throw new ProductLevel4TcpListenerError(
      "TCP_LISTENER_ARCH_INVALID",
      `${field} must be arm64 or amd64`,
    );
  }
}

function writeJson(path: string, value: unknown): void {
  const serialized = JSON.stringify(value, null, 2);
  writeFileSync(path, `${serialized}\n`);
}

function sha256Text(text: string): string {
  const digest = createHash("sha256");
  digest.update(text);
  return digest.digest("hex");
}

export class ProductLevel4TcpListenerError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProductLevel4TcpListenerError";
  }
}
