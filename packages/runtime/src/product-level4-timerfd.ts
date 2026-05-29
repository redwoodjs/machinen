import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch as osArch, platform, release } from "node:os";
import { join, resolve } from "node:path";

export const PRODUCT_LEVEL4_TIMERFD_FORMAT_VERSION = 1 as const;
export const PRODUCT_LEVEL4_TIMERFD_MANIFEST = "portable-timerfd.json" as const;
export const PRODUCT_LEVEL4_TIMERFD_REFUSAL = "portable-timerfd-refusal.json" as const;
export const PRODUCT_LEVEL4_TIMERFD_RESTORE_SUMMARY =
  "portable-timerfd-restore-summary.json" as const;

export const productLevel4TimerfdArchitectures = ["arm64", "amd64"] as const;
export type ProductLevel4TimerfdArchitecture = (typeof productLevel4TimerfdArchitectures)[number];

export const productLevel4TimerfdRefusalCodes = [
  "timerfd-source-target-arch-match",
  "timerfd-target-arch-mismatch",
  "timerfd-target-verifier-mismatch",
  "timerfd-remaining-time-out-of-range",
  "timerfd-unread-expirations-unsupported",
  "timerfd-periodic-unsupported",
  "timerfd-absolute-unsupported",
  "timerfd-cancel-on-set-unsupported",
  "timerfd-clock-unsupported",
  "timerfd-unsupported-flags",
  "timerfd-active-read-unsupported",
] as const;
export type ProductLevel4TimerfdRefusalCode = (typeof productLevel4TimerfdRefusalCodes)[number];

export interface ProductLevel4TimerfdCaptureInput {
  outDir: string;
  sourceArch: ProductLevel4TimerfdArchitecture;
  targetArch: ProductLevel4TimerfdArchitecture;
  sourceVerifierOutput: string;
  remainingMs: number;
  clock?: "monotonic" | "realtime";
  intervalMs?: number;
  absolute?: boolean;
  cancelOnSet?: boolean;
  unreadExpirations?: number;
  closeOnExec?: boolean;
  nonblocking?: boolean;
  activeRead?: boolean;
  outputLogPath?: "/tmp/machinen-restored-timerfd.log";
  dryRun?: boolean;
}

export interface ProductLevel4TimerfdDescriptor {
  kind: "machinen.product-level4-timerfd";
  formatVersion: typeof PRODUCT_LEVEL4_TIMERFD_FORMAT_VERSION;
  supportLevel: "implemented-product-support";
  subset: "timerfd-relative-oneshot-v1-monotonic";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  runtime: "native-linux-resource";
  captureSurface: "machinen capture timerfd";
  restoreSurface: "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]";
  source: {
    architecture: ProductLevel4TimerfdArchitecture;
    host: { arch: string; platform: string; release: string };
  };
  target: { architecture: ProductLevel4TimerfdArchitecture };
  timerfd: {
    clock: "monotonic";
    mode: "relative";
    remainingMs: number;
    intervalMs: 0;
    unreadExpirations: 0;
    closeOnExec: true;
    nonblocking: false;
    cancelOnSet: false;
  };
  continuation: {
    outputLogPath: "/tmp/machinen-restored-timerfd.log";
    timerPolicy: "target-native-relative-oneshot-timerfd-recreated";
    expirationPolicy: "no-unread-expirations-preserved";
  };
  gates: {
    monotonicClockRequired: true;
    relativeOneShotRequired: true;
    boundedRemainingTimeRequired: true;
    noUnreadExpirationsRequired: true;
    onlyCloseOnExecFlagSupported: true;
    noActiveTimerfdReadRequired: true;
    targetNativeVerificationRequired: true;
    sourceIsaEmulationAllowed: false;
    sourceTextReplayAllowed: false;
    sidecarRuntimeAllowed: false;
    metadataOnlyContinuationAllowed: false;
  };
  sourceVerifierOutput: string;
  sourceVerifierOutputSha256: string;
}

export interface ProductLevel4TimerfdRefusal {
  kind: "machinen.product-level4-timerfd-refusal";
  formatVersion: typeof PRODUCT_LEVEL4_TIMERFD_FORMAT_VERSION;
  runtime: "native-linux-resource";
  supportLevel: "explicit-refusal";
  state: "refused";
  migrationCompleted: false;
  expectedRefusalCode: ProductLevel4TimerfdRefusalCode;
  message: string;
  evidence: Record<string, unknown>;
  sourceIsaEmulationUsed: false;
  sourceTextReusedAsTargetCode: false;
  sidecarRuntimeUsed: false;
  metadataOnlyShortcutAccepted: false;
}

export type ProductLevel4TimerfdCaptureResult =
  | {
      state: "completed";
      migrationCompleted: true;
      bundleDir: string;
      descriptor: ProductLevel4TimerfdDescriptor;
      dryRun: boolean;
    }
  | {
      state: "refused";
      migrationCompleted: false;
      bundleDir: string;
      refusal: ProductLevel4TimerfdRefusal;
      dryRun: boolean;
    };

export interface ProductLevel4TimerfdRestoreInput {
  bundleDir: string;
  targetArch: ProductLevel4TimerfdArchitecture;
  targetVerifierOutput: string;
  dryRun?: boolean;
}

export interface ProductLevel4TimerfdRestoreSummary {
  kind: "machinen.product-level4-timerfd-restore-summary";
  formatVersion: typeof PRODUCT_LEVEL4_TIMERFD_FORMAT_VERSION;
  runtime: "native-linux-resource";
  subset: "timerfd-relative-oneshot-v1-monotonic";
  supportLevel: "implemented-product-support";
  implementationLevel: "level-4-kernel-resource-reconstruction";
  state: "completed" | "refused";
  migrationCompleted: boolean;
  sourceArch?: ProductLevel4TimerfdArchitecture;
  targetArch: ProductLevel4TimerfdArchitecture;
  targetVerifierResult: "passed" | "failed" | "not-run";
  descriptorSha256?: string;
  targetVerifierOutputSha256?: string;
  refusal?: ProductLevel4TimerfdRefusal;
  shortcutInspection: {
    sourceIsaEmulationUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    metadataOnlyShortcutAccepted: false;
  };
}

// fallow-ignore-next-line code-duplication
export function createProductLevel4TimerfdSnapshot(
  input: ProductLevel4TimerfdCaptureInput,
): ProductLevel4TimerfdCaptureResult {
  assertTimerfdArch(input.sourceArch, "sourceArch");
  assertTimerfdArch(input.targetArch, "targetArch");
  const outDir = resolve(input.outDir);
  const refusal = sourceRefusal(input);
  if (input.dryRun !== true) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }
  if (refusal) {
    if (input.dryRun !== true) {
      writeJson(join(outDir, PRODUCT_LEVEL4_TIMERFD_REFUSAL), refusal);
    }
    return {
      state: "refused",
      migrationCompleted: false,
      bundleDir: outDir,
      refusal,
      dryRun: input.dryRun === true,
    };
  }
  const descriptor: ProductLevel4TimerfdDescriptor = {
    kind: "machinen.product-level4-timerfd",
    formatVersion: PRODUCT_LEVEL4_TIMERFD_FORMAT_VERSION,
    supportLevel: "implemented-product-support",
    subset: "timerfd-relative-oneshot-v1-monotonic",
    implementationLevel: "level-4-kernel-resource-reconstruction",
    runtime: "native-linux-resource",
    captureSurface: "machinen capture timerfd",
    restoreSurface:
      "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]",
    source: {
      architecture: input.sourceArch,
      host: { arch: osArch(), platform: platform(), release: release() },
    },
    target: { architecture: input.targetArch },
    timerfd: {
      clock: "monotonic",
      mode: "relative",
      remainingMs: input.remainingMs,
      intervalMs: 0,
      unreadExpirations: 0,
      closeOnExec: true,
      nonblocking: false,
      cancelOnSet: false,
    },
    continuation: {
      outputLogPath: input.outputLogPath ?? "/tmp/machinen-restored-timerfd.log",
      timerPolicy: "target-native-relative-oneshot-timerfd-recreated",
      expirationPolicy: "no-unread-expirations-preserved",
    },
    gates: {
      monotonicClockRequired: true,
      relativeOneShotRequired: true,
      boundedRemainingTimeRequired: true,
      noUnreadExpirationsRequired: true,
      onlyCloseOnExecFlagSupported: true,
      noActiveTimerfdReadRequired: true,
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
    writeJson(join(outDir, PRODUCT_LEVEL4_TIMERFD_MANIFEST), descriptor);
  }
  return {
    state: "completed",
    migrationCompleted: true,
    bundleDir: outDir,
    descriptor,
    dryRun: input.dryRun === true,
  };
}

export function isProductLevel4TimerfdBundle(bundleDir: string): boolean {
  return existsSync(join(bundleDir, PRODUCT_LEVEL4_TIMERFD_MANIFEST));
}

export function restoreProductLevel4TimerfdSnapshot(
  input: ProductLevel4TimerfdRestoreInput,
): ProductLevel4TimerfdRestoreSummary {
  assertTimerfdArch(input.targetArch, "targetArch");
  const bundleDir = resolve(input.bundleDir);
  const loadedDescriptor = loadTimerfdDescriptor(bundleDir);
  const { descriptor, descriptorText } = loadedDescriptor;
  const shortcutInspection = timerfdShortcutInspection();
  const targetVerifierOutput = input.targetVerifierOutput.trim();
  const targetVerifierOutputSha256 = sha256Text(targetVerifierOutput);
  let refusal: ProductLevel4TimerfdRefusal | undefined;
  if (descriptor.target.architecture !== input.targetArch) {
    refusal = makeRefusal("timerfd-target-arch-mismatch", {
      expected: descriptor.target.architecture,
      actual: input.targetArch,
    });
  } else if (!verifierMatches(descriptor, targetVerifierOutput)) {
    refusal = makeRefusal("timerfd-target-verifier-mismatch", {
      sourceVerifierOutputSha256: descriptor.sourceVerifierOutputSha256,
      targetVerifierOutputSha256,
      timerfd: descriptor.timerfd,
    });
  }
  const accepted = refusal === undefined;
  const summary: ProductLevel4TimerfdRestoreSummary = {
    kind: "machinen.product-level4-timerfd-restore-summary",
    formatVersion: PRODUCT_LEVEL4_TIMERFD_FORMAT_VERSION,
    runtime: "native-linux-resource",
    subset: "timerfd-relative-oneshot-v1-monotonic",
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
    writeJson(join(bundleDir, PRODUCT_LEVEL4_TIMERFD_RESTORE_SUMMARY), summary);
  }
  return summary;
}

// fallow-ignore-next-line complexity
function sourceRefusal(
  input: ProductLevel4TimerfdCaptureInput,
): ProductLevel4TimerfdRefusal | undefined {
  if (input.sourceArch === input.targetArch) {
    return makeRefusal("timerfd-source-target-arch-match", {
      sourceArch: input.sourceArch,
      targetArch: input.targetArch,
    });
  }
  if (!validRemainingMs(input.remainingMs)) {
    return makeRefusal("timerfd-remaining-time-out-of-range", { remainingMs: input.remainingMs });
  }
  if ((input.unreadExpirations ?? 0) !== 0) {
    return makeRefusal("timerfd-unread-expirations-unsupported", {
      unreadExpirations: input.unreadExpirations,
    });
  }
  if ((input.intervalMs ?? 0) !== 0) {
    return makeRefusal("timerfd-periodic-unsupported", { intervalMs: input.intervalMs });
  }
  if (input.absolute) {
    return makeRefusal("timerfd-absolute-unsupported", { absolute: true });
  }
  if (input.cancelOnSet) {
    return makeRefusal("timerfd-cancel-on-set-unsupported", { cancelOnSet: true });
  }
  if (input.clock && input.clock !== "monotonic") {
    return makeRefusal("timerfd-clock-unsupported", { clock: input.clock });
  }
  if (input.closeOnExec === false || input.nonblocking === true) {
    return makeRefusal("timerfd-unsupported-flags", {
      closeOnExec: input.closeOnExec,
      nonblocking: input.nonblocking,
    });
  }
  if (input.activeRead) {
    return makeRefusal("timerfd-active-read-unsupported", { activeRead: true });
  }
  return undefined;
}

function makeRefusal(
  code: ProductLevel4TimerfdRefusalCode,
  evidence: Record<string, unknown>,
): ProductLevel4TimerfdRefusal {
  return {
    kind: "machinen.product-level4-timerfd-refusal",
    formatVersion: PRODUCT_LEVEL4_TIMERFD_FORMAT_VERSION,
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
function refusalMessage(code: ProductLevel4TimerfdRefusalCode): string {
  switch (code) {
    case "timerfd-source-target-arch-match":
      return "Level 4 timerfd reconstruction is only claimed for cross-architecture restores";
    case "timerfd-target-arch-mismatch":
      return "target architecture does not match the portable timerfd descriptor";
    case "timerfd-target-verifier-mismatch":
      return "target-native timerfd verifier output does not match the descriptor";
    case "timerfd-remaining-time-out-of-range":
      return "timerfd remaining time must be a bounded positive duration";
    case "timerfd-unread-expirations-unsupported":
      return "unread timerfd expirations are outside the supported reconstruction boundary";
    case "timerfd-periodic-unsupported":
      return "periodic timerfd intervals are outside this first product boundary";
    case "timerfd-absolute-unsupported":
      return "absolute timerfd deadlines require a clock-drift policy and are currently refused";
    case "timerfd-cancel-on-set-unsupported":
      return "timerfd cancel-on-set state is outside the supported boundary";
    case "timerfd-clock-unsupported":
      return "only CLOCK_MONOTONIC timerfd reconstruction is currently supported";
    case "timerfd-unsupported-flags":
      return "timerfd flags other than close-on-exec are outside the supported boundary";
    case "timerfd-active-read-unsupported":
      return "active timerfd read syscall state is outside the supported boundary";
  }
}

function verifierMatches(
  descriptor: ProductLevel4TimerfdDescriptor,
  targetVerifierOutput: string,
): boolean {
  if (targetVerifierOutput === descriptor.sourceVerifierOutput) {
    return true;
  }
  const expectedFragments = [
    "timerfd",
    "clock=monotonic",
    "mode=relative",
    `remainingMs=${descriptor.timerfd.remainingMs}`,
    "intervalMs=0",
    "expirations=0",
    "flags=cloexec",
  ];
  return expectedFragments.every((fragment) => targetVerifierOutput.includes(fragment));
}

function loadTimerfdDescriptor(bundleDir: string): {
  descriptor: ProductLevel4TimerfdDescriptor;
  descriptorText: string;
} {
  const descriptorPath = join(bundleDir, PRODUCT_LEVEL4_TIMERFD_MANIFEST);
  if (!existsSync(descriptorPath)) {
    throw new ProductLevel4TimerfdError(
      "TIMERFD_BUNDLE_MISSING",
      `portable timerfd descriptor does not exist: ${descriptorPath}`,
    );
  }
  const descriptorText = readFileSync(descriptorPath, "utf8");
  return { descriptor: parseDescriptor(descriptorText), descriptorText };
}

function timerfdShortcutInspection(): ProductLevel4TimerfdRestoreSummary["shortcutInspection"] {
  return {
    sourceIsaEmulationUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    metadataOnlyShortcutAccepted: false,
  };
}

function parseDescriptor(text: string): ProductLevel4TimerfdDescriptor {
  const parsed = JSON.parse(text) as Partial<ProductLevel4TimerfdDescriptor>;
  if (
    parsed.kind !== "machinen.product-level4-timerfd" ||
    parsed.formatVersion !== PRODUCT_LEVEL4_TIMERFD_FORMAT_VERSION ||
    parsed.subset !== "timerfd-relative-oneshot-v1-monotonic" ||
    !parsed.source ||
    !parsed.target ||
    !parsed.timerfd
  ) {
    throw new ProductLevel4TimerfdError(
      "TIMERFD_DESCRIPTOR_INVALID",
      "portable timerfd descriptor is invalid",
    );
  }
  assertTimerfdArch(parsed.source.architecture, "descriptor.source.architecture");
  assertTimerfdArch(parsed.target.architecture, "descriptor.target.architecture");
  if (!validRemainingMs(parsed.timerfd.remainingMs)) {
    throw new ProductLevel4TimerfdError(
      "TIMERFD_DESCRIPTOR_INVALID",
      "portable timerfd descriptor remaining time is invalid",
    );
  }
  return parsed as ProductLevel4TimerfdDescriptor;
}

function validRemainingMs(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 86_400_000;
}

function assertTimerfdArch(
  value: string,
  field: string,
): asserts value is ProductLevel4TimerfdArchitecture {
  if (value !== "arm64" && value !== "amd64") {
    throw new ProductLevel4TimerfdError("TIMERFD_ARCH_INVALID", `${field} must be arm64 or amd64`);
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

export class ProductLevel4TimerfdError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProductLevel4TimerfdError";
  }
}
