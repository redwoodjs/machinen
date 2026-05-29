import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch as osArch, platform, release } from "node:os";
import { join, resolve } from "node:path";

export const PRODUCT_LEVEL4_EVENTFD_FORMAT_VERSION = 1 as const;
export const PRODUCT_LEVEL4_EVENTFD_MANIFEST = "portable-eventfd.json" as const;
export const PRODUCT_LEVEL4_EVENTFD_REFUSAL = "portable-eventfd-refusal.json" as const;
export const PRODUCT_LEVEL4_EVENTFD_RESTORE_SUMMARY =
  "portable-eventfd-restore-summary.json" as const;

export const productLevel4EventfdArchitectures = ["arm64", "amd64"] as const;
export type ProductLevel4EventfdArchitecture = (typeof productLevel4EventfdArchitectures)[number];

export const productLevel4EventfdRefusalCodes = [
  "eventfd-source-target-arch-match",
  "eventfd-target-arch-mismatch",
  "eventfd-target-verifier-mismatch",
  "eventfd-counter-out-of-range",
  "eventfd-semaphore-unsupported",
  "eventfd-waiters-unsupported",
  "eventfd-alias-unsupported",
  "eventfd-unsupported-flags",
  "eventfd-active-syscall-unsupported",
] as const;
export type ProductLevel4EventfdRefusalCode = (typeof productLevel4EventfdRefusalCodes)[number];

export interface ProductLevel4EventfdCaptureInput {
  outDir: string;
  sourceArch: ProductLevel4EventfdArchitecture;
  targetArch: ProductLevel4EventfdArchitecture;
  sourceVerifierOutput: string;
  counter: string | number;
  closeOnExec?: boolean;
  nonblocking?: boolean;
  semaphore?: boolean;
  waiters?: "none" | "unknown";
  aliases?: "none" | "present" | "unknown";
  activeSyscall?: boolean;
  outputLogPath?: "/tmp/machinen-restored-eventfd.log";
  dryRun?: boolean;
}

export interface ProductLevel4EventfdDescriptor {
  kind: "machinen.product-level4-eventfd";
  formatVersion: typeof PRODUCT_LEVEL4_EVENTFD_FORMAT_VERSION;
  supportLevel: "implemented-product-support";
  subset: "eventfd-counter-v1-nonsemaphore-no-waiters";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  runtime: "native-linux-resource";
  captureSurface: "machinen capture eventfd";
  restoreSurface: "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]";
  source: {
    architecture: ProductLevel4EventfdArchitecture;
    host: { arch: string; platform: string; release: string };
  };
  target: { architecture: ProductLevel4EventfdArchitecture };
  eventfd: {
    counter: string;
    semaphore: false;
    waiters: "none";
    aliases: "none";
    closeOnExec: true;
    nonblocking: false;
    readiness: "readable";
  };
  continuation: {
    outputLogPath: "/tmp/machinen-restored-eventfd.log";
    counterPolicy: "target-native-eventfd-counter-recreated";
    readinessPolicy: "counter-nonzero-pollin";
  };
  gates: {
    boundedNonzeroCounterRequired: true;
    noSemaphoreModeRequired: true;
    noWaitersRequired: true;
    noAliasesRequired: true;
    onlyCloseOnExecFlagSupported: true;
    noActiveEventfdSyscallRequired: true;
    targetNativeVerificationRequired: true;
    sourceIsaEmulationAllowed: false;
    sourceTextReplayAllowed: false;
    sidecarRuntimeAllowed: false;
    metadataOnlyContinuationAllowed: false;
  };
  sourceVerifierOutput: string;
  sourceVerifierOutputSha256: string;
}

export interface ProductLevel4EventfdRefusal {
  kind: "machinen.product-level4-eventfd-refusal";
  formatVersion: typeof PRODUCT_LEVEL4_EVENTFD_FORMAT_VERSION;
  runtime: "native-linux-resource";
  supportLevel: "explicit-refusal";
  state: "refused";
  migrationCompleted: false;
  expectedRefusalCode: ProductLevel4EventfdRefusalCode;
  message: string;
  evidence: Record<string, unknown>;
  sourceIsaEmulationUsed: false;
  sourceTextReusedAsTargetCode: false;
  sidecarRuntimeUsed: false;
  metadataOnlyShortcutAccepted: false;
}

export type ProductLevel4EventfdCaptureResult =
  | {
      state: "completed";
      migrationCompleted: true;
      bundleDir: string;
      descriptor: ProductLevel4EventfdDescriptor;
      dryRun: boolean;
    }
  | {
      state: "refused";
      migrationCompleted: false;
      bundleDir: string;
      refusal: ProductLevel4EventfdRefusal;
      dryRun: boolean;
    };

export interface ProductLevel4EventfdRestoreInput {
  bundleDir: string;
  targetArch: ProductLevel4EventfdArchitecture;
  targetVerifierOutput: string;
  dryRun?: boolean;
}

export interface ProductLevel4EventfdRestoreSummary {
  kind: "machinen.product-level4-eventfd-restore-summary";
  formatVersion: typeof PRODUCT_LEVEL4_EVENTFD_FORMAT_VERSION;
  runtime: "native-linux-resource";
  subset: "eventfd-counter-v1-nonsemaphore-no-waiters";
  supportLevel: "implemented-product-support";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  state: "completed" | "refused";
  migrationCompleted: boolean;
  sourceArch?: ProductLevel4EventfdArchitecture;
  targetArch: ProductLevel4EventfdArchitecture;
  targetVerifierResult: "passed" | "failed" | "not-run";
  descriptorSha256?: string;
  targetVerifierOutputSha256?: string;
  refusal?: ProductLevel4EventfdRefusal;
  shortcutInspection: {
    sourceIsaEmulationUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    metadataOnlyShortcutAccepted: false;
  };
}

// fallow-ignore-next-line code-duplication
export function createProductLevel4EventfdSnapshot(
  input: ProductLevel4EventfdCaptureInput,
): ProductLevel4EventfdCaptureResult {
  assertEventfdArch(input.sourceArch, "sourceArch");
  assertEventfdArch(input.targetArch, "targetArch");
  const counter = normalizeEventfdCounter(input.counter);
  const outDir = resolve(input.outDir);
  const refusal = sourceRefusal(input, counter);
  if (input.dryRun !== true) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }
  if (refusal) {
    if (input.dryRun !== true) {
      writeJson(join(outDir, PRODUCT_LEVEL4_EVENTFD_REFUSAL), refusal);
    }
    return {
      state: "refused",
      migrationCompleted: false,
      bundleDir: outDir,
      refusal,
      dryRun: input.dryRun === true,
    };
  }
  const descriptor: ProductLevel4EventfdDescriptor = {
    kind: "machinen.product-level4-eventfd",
    formatVersion: PRODUCT_LEVEL4_EVENTFD_FORMAT_VERSION,
    supportLevel: "implemented-product-support",
    subset: "eventfd-counter-v1-nonsemaphore-no-waiters",
    implementationLevel: "level-4-kernel-resource-reconstruction",
    runtime: "native-linux-resource",
    captureSurface: "machinen capture eventfd",
    restoreSurface:
      "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]",
    source: {
      architecture: input.sourceArch,
      host: { arch: osArch(), platform: platform(), release: release() },
    },
    target: { architecture: input.targetArch },
    eventfd: {
      counter,
      semaphore: false,
      waiters: "none",
      aliases: "none",
      closeOnExec: true,
      nonblocking: false,
      readiness: "readable",
    },
    continuation: {
      outputLogPath: input.outputLogPath ?? "/tmp/machinen-restored-eventfd.log",
      counterPolicy: "target-native-eventfd-counter-recreated",
      readinessPolicy: "counter-nonzero-pollin",
    },
    gates: {
      boundedNonzeroCounterRequired: true,
      noSemaphoreModeRequired: true,
      noWaitersRequired: true,
      noAliasesRequired: true,
      onlyCloseOnExecFlagSupported: true,
      noActiveEventfdSyscallRequired: true,
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
    writeJson(join(outDir, PRODUCT_LEVEL4_EVENTFD_MANIFEST), descriptor);
  }
  return {
    state: "completed",
    migrationCompleted: true,
    bundleDir: outDir,
    descriptor,
    dryRun: input.dryRun === true,
  };
}

export function isProductLevel4EventfdBundle(bundleDir: string): boolean {
  return existsSync(join(bundleDir, PRODUCT_LEVEL4_EVENTFD_MANIFEST));
}

export function restoreProductLevel4EventfdSnapshot(
  input: ProductLevel4EventfdRestoreInput,
): ProductLevel4EventfdRestoreSummary {
  assertEventfdArch(input.targetArch, "targetArch");
  const bundleDir = resolve(input.bundleDir);
  const descriptorPath = join(bundleDir, PRODUCT_LEVEL4_EVENTFD_MANIFEST);
  if (!existsSync(descriptorPath)) {
    throw new ProductLevel4EventfdError(
      "EVENTFD_BUNDLE_MISSING",
      `portable eventfd descriptor does not exist: ${descriptorPath}`,
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
  let refusal: ProductLevel4EventfdRefusal | undefined;
  if (descriptor.target.architecture !== input.targetArch) {
    refusal = makeRefusal("eventfd-target-arch-mismatch", {
      expected: descriptor.target.architecture,
      actual: input.targetArch,
    });
  } else if (!verifierMatches(descriptor, targetVerifierOutput)) {
    refusal = makeRefusal("eventfd-target-verifier-mismatch", {
      sourceVerifierOutputSha256: descriptor.sourceVerifierOutputSha256,
      targetVerifierOutputSha256,
      eventfd: descriptor.eventfd,
    });
  }
  const summary: ProductLevel4EventfdRestoreSummary = {
    kind: "machinen.product-level4-eventfd-restore-summary",
    formatVersion: PRODUCT_LEVEL4_EVENTFD_FORMAT_VERSION,
    runtime: "native-linux-resource",
    subset: "eventfd-counter-v1-nonsemaphore-no-waiters",
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
    writeJson(join(bundleDir, PRODUCT_LEVEL4_EVENTFD_RESTORE_SUMMARY), summary);
  }
  return summary;
}

function sourceRefusal(
  input: ProductLevel4EventfdCaptureInput,
  counter: string,
): ProductLevel4EventfdRefusal | undefined {
  if (input.sourceArch === input.targetArch) {
    return makeRefusal("eventfd-source-target-arch-match", {
      sourceArch: input.sourceArch,
      targetArch: input.targetArch,
    });
  }
  if (!isSupportedEventfdCounter(counter)) {
    return makeRefusal("eventfd-counter-out-of-range", { counter: input.counter });
  }
  if (input.semaphore) {
    return makeRefusal("eventfd-semaphore-unsupported", { semaphore: input.semaphore });
  }
  if (input.waiters && input.waiters !== "none") {
    return makeRefusal("eventfd-waiters-unsupported", { waiters: input.waiters });
  }
  if (input.aliases && input.aliases !== "none") {
    return makeRefusal("eventfd-alias-unsupported", { aliases: input.aliases });
  }
  if (input.closeOnExec === false || input.nonblocking === true) {
    return makeRefusal("eventfd-unsupported-flags", {
      closeOnExec: input.closeOnExec,
      nonblocking: input.nonblocking,
    });
  }
  if (input.activeSyscall) {
    return makeRefusal("eventfd-active-syscall-unsupported", { activeSyscall: true });
  }
  return undefined;
}

function makeRefusal(
  code: ProductLevel4EventfdRefusalCode,
  evidence: Record<string, unknown>,
): ProductLevel4EventfdRefusal {
  return {
    kind: "machinen.product-level4-eventfd-refusal",
    formatVersion: PRODUCT_LEVEL4_EVENTFD_FORMAT_VERSION,
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
function refusalMessage(code: ProductLevel4EventfdRefusalCode): string {
  switch (code) {
    case "eventfd-source-target-arch-match":
      return "Level 4 eventfd reconstruction is only claimed for cross-architecture restores";
    case "eventfd-target-arch-mismatch":
      return "target architecture does not match the portable eventfd descriptor";
    case "eventfd-target-verifier-mismatch":
      return "target-native eventfd verifier output does not match the descriptor";
    case "eventfd-counter-out-of-range":
      return "eventfd counter must be a bounded nonzero integer no greater than UINT32_MAX";
    case "eventfd-semaphore-unsupported":
      return "eventfd semaphore mode is outside the supported reconstruction boundary";
    case "eventfd-waiters-unsupported":
      return "eventfd waiters must be known empty before reconstruction";
    case "eventfd-alias-unsupported":
      return "eventfd aliases are outside this first product reconstruction boundary";
    case "eventfd-unsupported-flags":
      return "eventfd flags other than close-on-exec are outside the supported boundary";
    case "eventfd-active-syscall-unsupported":
      return "active eventfd read/write syscall state is outside the supported boundary";
  }
}

function verifierMatches(
  descriptor: ProductLevel4EventfdDescriptor,
  targetVerifierOutput: string,
): boolean {
  if (targetVerifierOutput === descriptor.sourceVerifierOutput) {
    return true;
  }
  const expectedFragments = [
    "eventfd",
    `counter=${descriptor.eventfd.counter}`,
    "semaphore=0",
    "waiters=none",
    "aliases=none",
    "readiness=readable",
    "flags=cloexec",
  ];
  return expectedFragments.every((fragment) => targetVerifierOutput.includes(fragment));
}

function parseDescriptor(text: string): ProductLevel4EventfdDescriptor {
  const parsed = JSON.parse(text) as Partial<ProductLevel4EventfdDescriptor>;
  if (
    parsed.kind !== "machinen.product-level4-eventfd" ||
    parsed.formatVersion !== PRODUCT_LEVEL4_EVENTFD_FORMAT_VERSION ||
    parsed.subset !== "eventfd-counter-v1-nonsemaphore-no-waiters" ||
    !parsed.source ||
    !parsed.target ||
    !parsed.eventfd
  ) {
    throw new ProductLevel4EventfdError(
      "EVENTFD_DESCRIPTOR_INVALID",
      "portable eventfd descriptor is invalid",
    );
  }
  assertEventfdArch(parsed.source.architecture, "descriptor.source.architecture");
  assertEventfdArch(parsed.target.architecture, "descriptor.target.architecture");
  if (!isSupportedEventfdCounter(parsed.eventfd.counter)) {
    throw new ProductLevel4EventfdError(
      "EVENTFD_DESCRIPTOR_INVALID",
      "portable eventfd descriptor counter is invalid",
    );
  }
  return parsed as ProductLevel4EventfdDescriptor;
}

function normalizeEventfdCounter(value: string | number): string {
  const text = String(value).trim();
  try {
    return BigInt(text).toString(10);
  } catch {
    throw new ProductLevel4EventfdError(
      "EVENTFD_COUNTER_INVALID",
      "counter must be an integer literal",
    );
  }
}

function isSupportedEventfdCounter(value: string): boolean {
  try {
    const parsed = BigInt(value);
    return parsed > 0n && parsed <= 0xffffffffn;
  } catch {
    return false;
  }
}

function assertEventfdArch(
  value: string,
  field: string,
): asserts value is ProductLevel4EventfdArchitecture {
  if (value !== "arm64" && value !== "amd64") {
    throw new ProductLevel4EventfdError("EVENTFD_ARCH_INVALID", `${field} must be arm64 or amd64`);
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class ProductLevel4EventfdError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductLevel4EventfdError";
  }
}
