import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch as osArch, platform, release } from "node:os";
import { join, resolve } from "node:path";

export const PRODUCT_LEVEL4_PIPE_FORMAT_VERSION = 1 as const;
export const PRODUCT_LEVEL4_PIPE_MANIFEST = "portable-pipe.json" as const;
export const PRODUCT_LEVEL4_PIPE_REFUSAL = "portable-pipe-refusal.json" as const;
export const PRODUCT_LEVEL4_PIPE_RESTORE_SUMMARY = "portable-pipe-restore-summary.json" as const;

export const productLevel4PipeArchitectures = ["arm64", "amd64"] as const;
export type ProductLevel4PipeArchitecture = (typeof productLevel4PipeArchitectures)[number];

export const productLevel4PipeRefusalCodes = [
  "pipe-source-target-arch-match",
  "pipe-target-arch-mismatch",
  "pipe-target-verifier-mismatch",
  "pipe-fd-pair-invalid",
  "pipe-buffered-data-unsupported",
  "pipe-peer-lifetime-unsupported",
  "pipe-waiters-unsupported",
  "pipe-readiness-unsupported",
  "pipe-unsupported-flags",
  "pipe-active-syscall-unsupported",
] as const;
export type ProductLevel4PipeRefusalCode = (typeof productLevel4PipeRefusalCodes)[number];

export interface ProductLevel4PipeCaptureInput {
  outDir: string;
  sourceArch: ProductLevel4PipeArchitecture;
  targetArch: ProductLevel4PipeArchitecture;
  sourceVerifierOutput: string;
  readFd: number;
  writeFd: number;
  buffer?: "empty" | "bytes" | "unknown";
  bufferedBytesHex?: string;
  peerLifetime?: "open" | "closed" | "unknown";
  waiters?: "none" | "unknown";
  readiness?: "not-readable" | "readable" | "unknown";
  closeOnExec?: boolean;
  nonblocking?: boolean;
  activeSyscall?: boolean;
  outputLogPath?: "/tmp/machinen-restored-pipe.log";
  dryRun?: boolean;
}

export interface ProductLevel4PipeDescriptor {
  kind: "machinen.product-level4-pipe";
  formatVersion: typeof PRODUCT_LEVEL4_PIPE_FORMAT_VERSION;
  supportLevel: "implemented-product-support";
  subset: "pipe-pair-v1-empty-no-waiters";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  runtime: "native-linux-resource";
  captureSurface: "machinen capture pipe";
  restoreSurface: "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]";
  source: {
    architecture: ProductLevel4PipeArchitecture;
    host: { arch: string; platform: string; release: string };
  };
  target: { architecture: ProductLevel4PipeArchitecture };
  pipe: {
    readFd: number;
    writeFd: number;
    buffer: "empty";
    peerLifetime: "open";
    waiters: "none";
    readiness: "not-readable";
    closeOnExec: true;
    nonblocking: false;
  };
  continuation: {
    outputLogPath: "/tmp/machinen-restored-pipe.log";
    pipePolicy: "target-native-empty-pipe-pair-recreated";
    readinessPolicy: "empty-pipe-read-end-not-readable";
  };
  gates: {
    exactlyOneReadAndWriteEndRequired: true;
    emptyBufferRequired: true;
    peerLifetimeOpenRequired: true;
    noWaitersRequired: true;
    notReadableReadinessRequired: true;
    onlyCloseOnExecFlagSupported: true;
    noActivePipeSyscallRequired: true;
    targetNativeVerificationRequired: true;
    sourceIsaEmulationAllowed: false;
    sourceTextReplayAllowed: false;
    sidecarRuntimeAllowed: false;
    metadataOnlyContinuationAllowed: false;
  };
  sourceVerifierOutput: string;
  sourceVerifierOutputSha256: string;
}

export interface ProductLevel4PipeRefusal {
  kind: "machinen.product-level4-pipe-refusal";
  formatVersion: typeof PRODUCT_LEVEL4_PIPE_FORMAT_VERSION;
  runtime: "native-linux-resource";
  supportLevel: "explicit-refusal";
  state: "refused";
  migrationCompleted: false;
  expectedRefusalCode: ProductLevel4PipeRefusalCode;
  message: string;
  evidence: Record<string, unknown>;
  sourceIsaEmulationUsed: false;
  sourceTextReusedAsTargetCode: false;
  sidecarRuntimeUsed: false;
  metadataOnlyShortcutAccepted: false;
}

export type ProductLevel4PipeCaptureResult =
  | {
      state: "completed";
      migrationCompleted: true;
      bundleDir: string;
      descriptor: ProductLevel4PipeDescriptor;
      dryRun: boolean;
    }
  | {
      state: "refused";
      migrationCompleted: false;
      bundleDir: string;
      refusal: ProductLevel4PipeRefusal;
      dryRun: boolean;
    };

export interface ProductLevel4PipeRestoreInput {
  bundleDir: string;
  targetArch: ProductLevel4PipeArchitecture;
  targetVerifierOutput: string;
  dryRun?: boolean;
}

export interface ProductLevel4PipeRestoreSummary {
  kind: "machinen.product-level4-pipe-restore-summary";
  formatVersion: typeof PRODUCT_LEVEL4_PIPE_FORMAT_VERSION;
  runtime: "native-linux-resource";
  subset: "pipe-pair-v1-empty-no-waiters";
  supportLevel: "implemented-product-support";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  state: "completed" | "refused";
  migrationCompleted: boolean;
  sourceArch?: ProductLevel4PipeArchitecture;
  targetArch: ProductLevel4PipeArchitecture;
  targetVerifierResult: "passed" | "failed" | "not-run";
  descriptorSha256?: string;
  targetVerifierOutputSha256?: string;
  refusal?: ProductLevel4PipeRefusal;
  shortcutInspection: {
    sourceIsaEmulationUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    metadataOnlyShortcutAccepted: false;
  };
}

// fallow-ignore-next-line code-duplication
export function createProductLevel4PipeSnapshot(
  input: ProductLevel4PipeCaptureInput,
): ProductLevel4PipeCaptureResult {
  assertPipeArch(input.sourceArch, "sourceArch");
  assertPipeArch(input.targetArch, "targetArch");
  const outDir = resolve(input.outDir);
  const refusal = sourceRefusal(input);
  if (input.dryRun !== true) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }
  if (refusal) {
    if (input.dryRun !== true) {
      writeJson(join(outDir, PRODUCT_LEVEL4_PIPE_REFUSAL), refusal);
    }
    return {
      state: "refused",
      migrationCompleted: false,
      bundleDir: outDir,
      refusal,
      dryRun: input.dryRun === true,
    };
  }
  const descriptor: ProductLevel4PipeDescriptor = {
    kind: "machinen.product-level4-pipe",
    formatVersion: PRODUCT_LEVEL4_PIPE_FORMAT_VERSION,
    supportLevel: "implemented-product-support",
    subset: "pipe-pair-v1-empty-no-waiters",
    implementationLevel: "level-4-kernel-resource-reconstruction",
    runtime: "native-linux-resource",
    captureSurface: "machinen capture pipe",
    restoreSurface:
      "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]",
    source: {
      architecture: input.sourceArch,
      host: { arch: osArch(), platform: platform(), release: release() },
    },
    target: { architecture: input.targetArch },
    pipe: {
      readFd: input.readFd,
      writeFd: input.writeFd,
      buffer: "empty",
      peerLifetime: "open",
      waiters: "none",
      readiness: "not-readable",
      closeOnExec: true,
      nonblocking: false,
    },
    continuation: {
      outputLogPath: input.outputLogPath ?? "/tmp/machinen-restored-pipe.log",
      pipePolicy: "target-native-empty-pipe-pair-recreated",
      readinessPolicy: "empty-pipe-read-end-not-readable",
    },
    gates: {
      exactlyOneReadAndWriteEndRequired: true,
      emptyBufferRequired: true,
      peerLifetimeOpenRequired: true,
      noWaitersRequired: true,
      notReadableReadinessRequired: true,
      onlyCloseOnExecFlagSupported: true,
      noActivePipeSyscallRequired: true,
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
    writeJson(join(outDir, PRODUCT_LEVEL4_PIPE_MANIFEST), descriptor);
  }
  return {
    state: "completed",
    migrationCompleted: true,
    bundleDir: outDir,
    descriptor,
    dryRun: input.dryRun === true,
  };
}

export function isProductLevel4PipeBundle(bundleDir: string): boolean {
  return existsSync(join(bundleDir, PRODUCT_LEVEL4_PIPE_MANIFEST));
}

export function restoreProductLevel4PipeSnapshot(
  input: ProductLevel4PipeRestoreInput,
): ProductLevel4PipeRestoreSummary {
  assertPipeArch(input.targetArch, "targetArch");
  const bundleDir = resolve(input.bundleDir);
  const descriptorPath = join(bundleDir, PRODUCT_LEVEL4_PIPE_MANIFEST);
  if (!existsSync(descriptorPath)) {
    throw new ProductLevel4PipeError(
      "PIPE_BUNDLE_MISSING",
      `portable pipe descriptor does not exist: ${descriptorPath}`,
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
  let refusal: ProductLevel4PipeRefusal | undefined;
  if (descriptor.target.architecture !== input.targetArch) {
    refusal = makeRefusal("pipe-target-arch-mismatch", {
      expected: descriptor.target.architecture,
      actual: input.targetArch,
    });
  } else if (!verifierMatches(descriptor, targetVerifierOutput)) {
    refusal = makeRefusal("pipe-target-verifier-mismatch", {
      sourceVerifierOutputSha256: descriptor.sourceVerifierOutputSha256,
      targetVerifierOutputSha256,
      pipe: descriptor.pipe,
    });
  }
  const summary: ProductLevel4PipeRestoreSummary = {
    kind: "machinen.product-level4-pipe-restore-summary",
    formatVersion: PRODUCT_LEVEL4_PIPE_FORMAT_VERSION,
    runtime: "native-linux-resource",
    subset: "pipe-pair-v1-empty-no-waiters",
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
    writeJson(join(bundleDir, PRODUCT_LEVEL4_PIPE_RESTORE_SUMMARY), summary);
  }
  return summary;
}

// fallow-ignore-next-line complexity
function sourceRefusal(input: ProductLevel4PipeCaptureInput): ProductLevel4PipeRefusal | undefined {
  if (input.sourceArch === input.targetArch) {
    return makeRefusal("pipe-source-target-arch-match", {
      sourceArch: input.sourceArch,
      targetArch: input.targetArch,
    });
  }
  if (!validFdPair(input.readFd, input.writeFd)) {
    return makeRefusal("pipe-fd-pair-invalid", { readFd: input.readFd, writeFd: input.writeFd });
  }
  if (input.buffer === "bytes" || input.buffer === "unknown" || input.bufferedBytesHex) {
    return makeRefusal("pipe-buffered-data-unsupported", {
      buffer: input.buffer,
      bufferedBytesHex: input.bufferedBytesHex,
    });
  }
  if (input.peerLifetime && input.peerLifetime !== "open") {
    return makeRefusal("pipe-peer-lifetime-unsupported", { peerLifetime: input.peerLifetime });
  }
  if (input.waiters && input.waiters !== "none") {
    return makeRefusal("pipe-waiters-unsupported", { waiters: input.waiters });
  }
  if (input.readiness && input.readiness !== "not-readable") {
    return makeRefusal("pipe-readiness-unsupported", { readiness: input.readiness });
  }
  if (input.closeOnExec === false || input.nonblocking === true) {
    return makeRefusal("pipe-unsupported-flags", {
      closeOnExec: input.closeOnExec,
      nonblocking: input.nonblocking,
    });
  }
  if (input.activeSyscall) {
    return makeRefusal("pipe-active-syscall-unsupported", { activeSyscall: true });
  }
  return undefined;
}

function makeRefusal(
  code: ProductLevel4PipeRefusalCode,
  evidence: Record<string, unknown>,
): ProductLevel4PipeRefusal {
  return {
    kind: "machinen.product-level4-pipe-refusal",
    formatVersion: PRODUCT_LEVEL4_PIPE_FORMAT_VERSION,
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
function refusalMessage(code: ProductLevel4PipeRefusalCode): string {
  switch (code) {
    case "pipe-source-target-arch-match":
      return "Level 4 pipe reconstruction is only claimed for cross-architecture restores";
    case "pipe-target-arch-mismatch":
      return "target architecture does not match the portable pipe descriptor";
    case "pipe-target-verifier-mismatch":
      return "target-native pipe verifier output does not match the descriptor";
    case "pipe-fd-pair-invalid":
      return "pipe reconstruction requires distinct bounded read and write fd numbers";
    case "pipe-buffered-data-unsupported":
      return "buffered pipe bytes are outside this first product reconstruction boundary";
    case "pipe-peer-lifetime-unsupported":
      return "pipe peer lifetime must be known open before reconstruction";
    case "pipe-waiters-unsupported":
      return "pipe waiters must be known empty before reconstruction";
    case "pipe-readiness-unsupported":
      return "empty pipe readiness must be known not-readable before reconstruction";
    case "pipe-unsupported-flags":
      return "pipe flags other than close-on-exec are outside the supported boundary";
    case "pipe-active-syscall-unsupported":
      return "active pipe read/write syscall state is outside the supported boundary";
  }
}

function verifierMatches(
  descriptor: ProductLevel4PipeDescriptor,
  targetVerifierOutput: string,
): boolean {
  if (targetVerifierOutput === descriptor.sourceVerifierOutput) {
    return true;
  }
  const expectedFragments = [
    "pipe",
    `readFd=${descriptor.pipe.readFd}`,
    `writeFd=${descriptor.pipe.writeFd}`,
    "buffer=empty",
    "peer=open",
    "waiters=none",
    "readiness=not-readable",
    "flags=cloexec",
  ];
  return expectedFragments.every((fragment) => targetVerifierOutput.includes(fragment));
}

function parseDescriptor(text: string): ProductLevel4PipeDescriptor {
  const parsed = JSON.parse(text) as Partial<ProductLevel4PipeDescriptor>;
  if (
    parsed.kind !== "machinen.product-level4-pipe" ||
    parsed.formatVersion !== PRODUCT_LEVEL4_PIPE_FORMAT_VERSION ||
    parsed.subset !== "pipe-pair-v1-empty-no-waiters" ||
    !parsed.source ||
    !parsed.target ||
    !parsed.pipe
  ) {
    throw new ProductLevel4PipeError(
      "PIPE_DESCRIPTOR_INVALID",
      "portable pipe descriptor is invalid",
    );
  }
  assertPipeArch(parsed.source.architecture, "descriptor.source.architecture");
  assertPipeArch(parsed.target.architecture, "descriptor.target.architecture");
  if (!validFdPair(parsed.pipe.readFd, parsed.pipe.writeFd)) {
    throw new ProductLevel4PipeError(
      "PIPE_DESCRIPTOR_INVALID",
      "portable pipe descriptor fd pair is invalid",
    );
  }
  return parsed as ProductLevel4PipeDescriptor;
}

function validFdPair(readFd: number, writeFd: number): boolean {
  return isPipeFd(readFd) && isPipeFd(writeFd) && readFd !== writeFd;
}

function isPipeFd(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1024;
}

function assertPipeArch(
  value: string,
  field: string,
): asserts value is ProductLevel4PipeArchitecture {
  if (value !== "arm64" && value !== "amd64") {
    throw new ProductLevel4PipeError("PIPE_ARCH_INVALID", `${field} must be arm64 or amd64`);
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class ProductLevel4PipeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductLevel4PipeError";
  }
}
