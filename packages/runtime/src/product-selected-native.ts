import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch as osArch, platform, release } from "node:os";
import { join, resolve } from "node:path";

export const PRODUCT_SELECTED_NATIVE_FORMAT_VERSION = 1 as const;
export const PRODUCT_SELECTED_NATIVE_MANIFEST = "portable-selected-native.json" as const;
export const PRODUCT_SELECTED_NATIVE_REFUSAL = "portable-selected-native-refusal.json" as const;
export const PRODUCT_SELECTED_NATIVE_RESTORE_SUMMARY =
  "portable-selected-native-restore-summary.json" as const;
export const PRODUCT_SELECTED_NATIVE_SOURCE_VERIFIER = "source-verifier.json" as const;
export const PRODUCT_SELECTED_NATIVE_SOURCE_CAPTURE = "source-capture.json" as const;
export const PRODUCT_SELECTED_NATIVE_TARGET_PLAN = "target-plan.json" as const;

export const productSelectedNativeArchitectures = ["arm64", "amd64"] as const;
export type ProductSelectedNativeArchitecture = (typeof productSelectedNativeArchitectures)[number];

export const productSelectedNativeRefusalCodes = [
  "native-source-target-arch-match",
  "native-source-verifier-invalid",
  "native-source-state-unsupported",
  "native-target-arch-mismatch",
  "native-target-verifier-invalid",
  "native-target-verifier-mismatch",
  "native-target-shortcut-detected",
] as const;
export type ProductSelectedNativeRefusalCode = (typeof productSelectedNativeRefusalCodes)[number];

export interface ProductSelectedNativeCaptureInput {
  outDir: string;
  sourceArch: ProductSelectedNativeArchitecture;
  targetArch: ProductSelectedNativeArchitecture;
  sourceVerifierOutput: string;
  sourceCapturePath?: string;
  targetPlanPath?: string;
  activeSyscall?: boolean;
  unsupportedResourceState?: boolean;
  dryRun?: boolean;
}

export interface ProductSelectedNativeDescriptor {
  kind: "machinen.product-selected-native";
  formatVersion: typeof PRODUCT_SELECTED_NATIVE_FORMAT_VERSION;
  supportLevel: "proof-only-product-path";
  subset: "selected-single-thread-native-workload-v1";
  implementationLevel: "native-product-path-e2e-gate";
  runtime: "native-linux-process";
  captureSurface: "machinen capture native";
  restoreSurface: "machinen restore <bundle> --target-arch <arch> --target-verifier-output <file>";
  source: {
    architecture: ProductSelectedNativeArchitecture;
    host: { arch: string; platform: string; release: string };
  };
  target: { architecture: ProductSelectedNativeArchitecture };
  artifacts: {
    sourceVerifierOutput: { path: typeof PRODUCT_SELECTED_NATIVE_SOURCE_VERIFIER; sha256: string };
    sourceCapture?: { path: typeof PRODUCT_SELECTED_NATIVE_SOURCE_CAPTURE; sha256: string };
    targetPlan?: { path: typeof PRODUCT_SELECTED_NATIVE_TARGET_PLAN; sha256: string };
  };
  selectedWorkload: {
    threadState: "single-stopped-outside-syscall";
    memory: "private-rw-page";
    stack: "target-ucontext-stack-with-guard";
    bootstrap: "argv-env-cwd";
    resources: [
      "closed-fd",
      "inherit-stdio",
      "reopen-file",
      "pipe-buffered-bytes",
      "eventfd-counter",
      "timerfd-one-shot",
      "epoll-interest-list",
      "tcp-listener-loopback",
    ];
  };
  gates: {
    selectedSingleThreadOnly: true;
    stoppedOutsideActiveSyscallRequired: true;
    selectedResourceSubsetOnly: true;
    targetNativeVerificationRequired: true;
    arbitraryLinuxProcessSupportClaimed: false;
    sourceIsaEmulationAllowed: false;
    rawCpuRestoreAllowed: false;
    runtimeProfileRestoreAllowed: false;
    sidecarRuntimeAllowed: false;
    appHooksAllowed: false;
    metadataOnlyContinuationAllowed: false;
  };
  sourceVerifierEvidence: ProductSelectedNativeVerifierEvidence;
}

export interface ProductSelectedNativeVerifierEvidence {
  targetArch: ProductSelectedNativeArchitecture;
  targetNativeExecution: true;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  runtimeProfileRestoreUsed: false;
  appHooksUsed: false;
  metadataOnlySuccessAccepted: false;
  checks: {
    memory: true;
    stack: true;
    bootstrap: true;
    targetFunctionReturned: true;
  };
  resources: {
    closedFd: true;
    stdio: true;
    reopenFile: true;
    pipe: true;
    eventfd: true;
    timerfd: true;
    epoll: true;
    tcpListener: true;
  };
}

export interface ProductSelectedNativeRefusal {
  kind: "machinen.product-selected-native-refusal";
  formatVersion: typeof PRODUCT_SELECTED_NATIVE_FORMAT_VERSION;
  runtime: "native-linux-process";
  supportLevel: "explicit-refusal";
  state: "refused";
  migrationCompleted: false;
  expectedRefusalCode: ProductSelectedNativeRefusalCode;
  message: string;
  evidence: Record<string, unknown>;
  arbitraryLinuxProcessSupportClaimed: false;
  rawCpuRestoreUsed: false;
  sourceIsaEmulationUsed: false;
  runtimeProfileRestoreUsed: false;
  sourceTextReusedAsTargetCode: false;
  sidecarRuntimeUsed: false;
  appHooksRequired: false;
  metadataOnlyShortcutAccepted: false;
}

export type ProductSelectedNativeCaptureResult =
  | {
      state: "completed";
      migrationCompleted: true;
      bundleDir: string;
      descriptor: ProductSelectedNativeDescriptor;
      dryRun: boolean;
    }
  | {
      state: "refused";
      migrationCompleted: false;
      bundleDir: string;
      refusal: ProductSelectedNativeRefusal;
      dryRun: boolean;
    };

export interface ProductSelectedNativeRestoreInput {
  bundleDir: string;
  targetArch: ProductSelectedNativeArchitecture;
  targetVerifierOutput: string;
  dryRun?: boolean;
}

export interface ProductSelectedNativeRestoreSummary {
  kind: "machinen.product-selected-native-restore-summary";
  formatVersion: typeof PRODUCT_SELECTED_NATIVE_FORMAT_VERSION;
  runtime: "native-linux-process";
  subset: "selected-single-thread-native-workload-v1";
  supportLevel: "proof-only-product-path";
  implementationLevel: "native-product-path-e2e-gate";
  state: "completed" | "refused";
  migrationCompleted: boolean;
  sourceArch?: ProductSelectedNativeArchitecture;
  targetArch: ProductSelectedNativeArchitecture;
  targetVerifierResult: "passed" | "failed" | "not-run";
  descriptorSha256?: string;
  targetVerifierOutputSha256?: string;
  refusal?: ProductSelectedNativeRefusal;
  publicClaimAllowed: false;
  publicClaim: {
    productSupport: null;
    broadSupport: null;
    arbitraryProcessCrossArchRestore: 0;
  };
  shortcutInspection: {
    rawCpuRestoreUsed: false;
    sourceIsaEmulationUsed: false;
    runtimeProfileRestoreUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    appHooksRequired: false;
    metadataOnlyShortcutAccepted: false;
  };
}

export function createProductSelectedNativeSnapshot(
  input: ProductSelectedNativeCaptureInput,
): ProductSelectedNativeCaptureResult {
  assertNativeArch(input.sourceArch, "sourceArch");
  assertNativeArch(input.targetArch, "targetArch");
  const outDir = resolve(input.outDir);
  const sourceRefusal = sourceStateRefusal(input);
  const sourceVerifier = sourceRefusal
    ? undefined
    : parseVerifierEvidence(input.sourceVerifierOutput, input.sourceArch, "source");
  const verifierRefusal = sourceVerifier?.refusal;
  if (input.dryRun !== true) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }
  const refusal = sourceRefusal ?? verifierRefusal;
  if (refusal) {
    if (input.dryRun !== true) {
      writeJson(join(outDir, PRODUCT_SELECTED_NATIVE_REFUSAL), refusal);
    }
    return {
      state: "refused",
      migrationCompleted: false,
      bundleDir: outDir,
      refusal,
      dryRun: input.dryRun === true,
    };
  }
  const sourceVerifierEvidence = sourceVerifier?.evidence;
  if (!sourceVerifierEvidence) {
    throw new ProductSelectedNativeError(
      "NATIVE_SELECTED_SOURCE_VERIFIER_INTERNAL",
      "selected native source verifier evidence was not available after refusal checks",
    );
  }
  const descriptor: ProductSelectedNativeDescriptor = {
    kind: "machinen.product-selected-native",
    formatVersion: PRODUCT_SELECTED_NATIVE_FORMAT_VERSION,
    supportLevel: "proof-only-product-path",
    subset: "selected-single-thread-native-workload-v1",
    implementationLevel: "native-product-path-e2e-gate",
    runtime: "native-linux-process",
    captureSurface: "machinen capture native",
    restoreSurface:
      "machinen restore <bundle> --target-arch <arch> --target-verifier-output <file>",
    source: {
      architecture: input.sourceArch,
      host: { arch: osArch(), platform: platform(), release: release() },
    },
    target: { architecture: input.targetArch },
    artifacts: sourceArtifacts(input),
    selectedWorkload: selectedWorkload(),
    gates: {
      selectedSingleThreadOnly: true,
      stoppedOutsideActiveSyscallRequired: true,
      selectedResourceSubsetOnly: true,
      targetNativeVerificationRequired: true,
      arbitraryLinuxProcessSupportClaimed: false,
      sourceIsaEmulationAllowed: false,
      rawCpuRestoreAllowed: false,
      runtimeProfileRestoreAllowed: false,
      sidecarRuntimeAllowed: false,
      appHooksAllowed: false,
      metadataOnlyContinuationAllowed: false,
    },
    sourceVerifierEvidence,
  };
  if (input.dryRun !== true) {
    writeFileSync(
      join(outDir, PRODUCT_SELECTED_NATIVE_SOURCE_VERIFIER),
      input.sourceVerifierOutput,
    );
    copyOptional(input.sourceCapturePath, join(outDir, PRODUCT_SELECTED_NATIVE_SOURCE_CAPTURE));
    copyOptional(input.targetPlanPath, join(outDir, PRODUCT_SELECTED_NATIVE_TARGET_PLAN));
    writeJson(join(outDir, PRODUCT_SELECTED_NATIVE_MANIFEST), descriptor);
  }
  return {
    state: "completed",
    migrationCompleted: true,
    bundleDir: outDir,
    descriptor,
    dryRun: input.dryRun === true,
  };
}

export function restoreProductSelectedNativeSnapshot(
  input: ProductSelectedNativeRestoreInput,
): ProductSelectedNativeRestoreSummary {
  assertNativeArch(input.targetArch, "targetArch");
  const bundleDir = resolve(input.bundleDir);
  const sourceRefusalPath = join(bundleDir, PRODUCT_SELECTED_NATIVE_REFUSAL);
  if (existsSync(sourceRefusalPath)) {
    const refusal = readRefusal(sourceRefusalPath);
    return writeRestoreSummary(bundleDir, input.dryRun, {
      ...baseRestoreSummary(input.targetArch),
      state: "refused",
      migrationCompleted: false,
      targetVerifierResult: "not-run",
      refusal: withEvidence(refusal, { restoreReason: "source capture was refused" }),
    });
  }
  const descriptorPath = join(bundleDir, PRODUCT_SELECTED_NATIVE_MANIFEST);
  if (!existsSync(descriptorPath)) {
    throw new ProductSelectedNativeError(
      "NATIVE_SELECTED_BUNDLE_MISSING",
      `selected native descriptor does not exist: ${descriptorPath}`,
    );
  }
  const descriptorText = readFileSync(descriptorPath, "utf8");
  const descriptor = parseDescriptor(descriptorText);
  const descriptorSha256 = sha256Text(descriptorText);
  const targetVerifierOutput = input.targetVerifierOutput.trim();
  const targetVerifierOutputSha256 = sha256Text(targetVerifierOutput);
  const targetVerifier = parseVerifierEvidence(targetVerifierOutput, input.targetArch, "target");
  const refusal = restoreRefusal(descriptor, input.targetArch, targetVerifier);
  return writeRestoreSummary(bundleDir, input.dryRun, {
    ...baseRestoreSummary(input.targetArch),
    state: refusal ? "refused" : "completed",
    migrationCompleted: refusal === undefined,
    sourceArch: descriptor.source.architecture,
    targetVerifierResult: refusal ? "failed" : "passed",
    descriptorSha256,
    targetVerifierOutputSha256,
    refusal,
  });
}

export function isProductSelectedNativeBundle(bundleDir: string): boolean {
  const dir = resolve(bundleDir);
  return (
    existsSync(join(dir, PRODUCT_SELECTED_NATIVE_MANIFEST)) ||
    existsSync(join(dir, PRODUCT_SELECTED_NATIVE_REFUSAL))
  );
}

export class ProductSelectedNativeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductSelectedNativeError";
  }
}

function sourceStateRefusal(
  input: ProductSelectedNativeCaptureInput,
): ProductSelectedNativeRefusal | undefined {
  if (input.sourceArch === input.targetArch) {
    return makeRefusal(
      "native-source-target-arch-match",
      "selected native proof requires cross-architecture source/target pair",
      {
        sourceArch: input.sourceArch,
        targetArch: input.targetArch,
      },
    );
  }
  if (input.activeSyscall === true) {
    return makeRefusal(
      "native-source-state-unsupported",
      "active syscall source state is outside the selected native product-path subset",
      {
        activeSyscall: true,
        boundary: "single-stopped-outside-syscall",
      },
    );
  }
  if (input.unsupportedResourceState === true) {
    return makeRefusal(
      "native-source-state-unsupported",
      "unsupported resource state is outside the selected native product-path subset",
      {
        unsupportedResourceState: true,
        boundary: "selected-resource-subset-only",
      },
    );
  }
  return undefined;
}

function restoreRefusal(
  descriptor: ProductSelectedNativeDescriptor,
  targetArch: ProductSelectedNativeArchitecture,
  targetVerifier: ParsedVerifierEvidence,
): ProductSelectedNativeRefusal | undefined {
  if (descriptor.target.architecture !== targetArch) {
    return makeRefusal(
      "native-target-arch-mismatch",
      "target architecture does not match the selected native bundle",
      {
        expected: descriptor.target.architecture,
        actual: targetArch,
      },
    );
  }
  if (targetVerifier.refusal) {
    return targetVerifier.refusal;
  }
  if (!semanticEvidenceMatches(descriptor.sourceVerifierEvidence, targetVerifier.evidence!)) {
    return makeRefusal(
      "native-target-verifier-mismatch",
      "target-native verifier output does not match the selected source workload evidence",
      {
        source: semanticEvidenceForCompare(descriptor.sourceVerifierEvidence),
        target: semanticEvidenceForCompare(targetVerifier.evidence!),
      },
    );
  }
  return undefined;
}

type ParsedVerifierEvidence =
  | { evidence: ProductSelectedNativeVerifierEvidence; refusal?: undefined }
  | { evidence?: undefined; refusal: ProductSelectedNativeRefusal };

function parseVerifierEvidence(
  text: string,
  expectedArch: ProductSelectedNativeArchitecture,
  role: "source" | "target",
): ParsedVerifierEvidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch (error) {
    return {
      refusal: makeRefusal(
        role === "source" ? "native-source-verifier-invalid" : "native-target-verifier-invalid",
        `${role} verifier output is not valid JSON`,
        { error: error instanceof Error ? error.message : String(error) },
      ),
    };
  }
  const verifier = verifierPayload(parsed);
  const shortcutRefusal = shortcutRefusalFor(verifier, role);
  if (shortcutRefusal) {
    return { refusal: shortcutRefusal };
  }
  if (!validVerifierShape(verifier, expectedArch)) {
    return {
      refusal: makeRefusal(
        role === "source" ? "native-source-verifier-invalid" : "native-target-verifier-invalid",
        `${role} verifier output does not prove the selected native workload subset`,
        { expectedArch, verifier },
      ),
    };
  }
  return { evidence: verifierEvidence(verifier) };
}

function verifierEvidence(
  verifier: Record<string, unknown>,
): ProductSelectedNativeVerifierEvidence {
  return {
    targetArch: verifier.targetArch as ProductSelectedNativeArchitecture,
    targetNativeExecution: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    runtimeProfileRestoreUsed: false,
    appHooksUsed: false,
    metadataOnlySuccessAccepted: false,
    checks: {
      memory: true,
      stack: true,
      bootstrap: true,
      targetFunctionReturned: true,
    },
    resources: {
      closedFd: true,
      stdio: true,
      reopenFile: true,
      pipe: true,
      eventfd: true,
      timerfd: true,
      epoll: true,
      tcpListener: true,
    },
  };
}

function verifierPayload(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    return {};
  }
  const nested = value.verifier;
  if (isObject(nested)) {
    return nested;
  }
  return value;
}

function shortcutRefusalFor(
  verifier: Record<string, unknown>,
  role: "source" | "target",
): ProductSelectedNativeRefusal | undefined {
  const shortcutDetected =
    verifier.rawCpuRestoreUsed !== false ||
    verifier.sourceIsaEmulationUsed !== false ||
    verifier.runtimeProfileRestoreUsed !== false ||
    verifier.appHooksUsed !== false ||
    verifier.metadataOnlySuccessAccepted !== false;
  if (!shortcutDetected) {
    return undefined;
  }
  return makeRefusal(
    role === "source" ? "native-source-verifier-invalid" : "native-target-shortcut-detected",
    `${role} verifier output used a forbidden shortcut`,
    {
      rawCpuRestoreUsed: verifier.rawCpuRestoreUsed,
      sourceIsaEmulationUsed: verifier.sourceIsaEmulationUsed,
      runtimeProfileRestoreUsed: verifier.runtimeProfileRestoreUsed,
      appHooksUsed: verifier.appHooksUsed,
      metadataOnlySuccessAccepted: verifier.metadataOnlySuccessAccepted,
    },
  );
}

function validVerifierShape(
  verifier: Record<string, unknown>,
  expectedArch: ProductSelectedNativeArchitecture,
): boolean {
  const checks = verifier.checks;
  const resources = verifier.resources;
  return (
    verifier.status === "passed" &&
    verifier.targetArch === expectedArch &&
    verifier.targetNativeExecution === true &&
    verifier.rawCpuRestoreUsed === false &&
    verifier.sourceIsaEmulationUsed === false &&
    verifier.runtimeProfileRestoreUsed === false &&
    verifier.appHooksUsed === false &&
    verifier.metadataOnlySuccessAccepted === false &&
    isObject(checks) &&
    checks.memory === true &&
    checks.stack === true &&
    checks.bootstrap === true &&
    checks.targetFunctionReturned === true &&
    isObject(resources) &&
    resources.closedFd === true &&
    resources.stdio === true &&
    resources.reopenFile === true &&
    resources.pipe === true &&
    resources.eventfd === true &&
    resources.timerfd === true &&
    resources.epoll === true &&
    resources.tcpListener === true
  );
}

function semanticEvidenceMatches(
  source: ProductSelectedNativeVerifierEvidence,
  target: ProductSelectedNativeVerifierEvidence,
): boolean {
  return (
    JSON.stringify(semanticEvidenceForCompare(source)) ===
    JSON.stringify(semanticEvidenceForCompare(target))
  );
}

function semanticEvidenceForCompare(
  evidence: ProductSelectedNativeVerifierEvidence,
): Omit<ProductSelectedNativeVerifierEvidence, "targetArch"> {
  const { targetArch: _targetArch, ...rest } = evidence;
  return rest;
}

function sourceArtifacts(
  input: ProductSelectedNativeCaptureInput,
): ProductSelectedNativeDescriptor["artifacts"] {
  const artifacts: ProductSelectedNativeDescriptor["artifacts"] = {
    sourceVerifierOutput: {
      path: PRODUCT_SELECTED_NATIVE_SOURCE_VERIFIER,
      sha256: sha256Text(input.sourceVerifierOutput),
    },
  };
  const sourceCaptureSha = optionalFileSha256(input.sourceCapturePath);
  if (sourceCaptureSha) {
    artifacts.sourceCapture = {
      path: PRODUCT_SELECTED_NATIVE_SOURCE_CAPTURE,
      sha256: sourceCaptureSha,
    };
  }
  const targetPlanSha = optionalFileSha256(input.targetPlanPath);
  if (targetPlanSha) {
    artifacts.targetPlan = { path: PRODUCT_SELECTED_NATIVE_TARGET_PLAN, sha256: targetPlanSha };
  }
  return artifacts;
}

function optionalFileSha256(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new ProductSelectedNativeError(
      "NATIVE_SELECTED_ARTIFACT_MISSING",
      `selected native artifact does not exist: ${abs}`,
    );
  }
  return sha256Bytes(readFileSync(abs));
}

function copyOptional(source: string | undefined, dest: string): void {
  if (!source) {
    return;
  }
  copyFileSync(resolve(source), dest);
}

function selectedWorkload(): ProductSelectedNativeDescriptor["selectedWorkload"] {
  return {
    threadState: "single-stopped-outside-syscall",
    memory: "private-rw-page",
    stack: "target-ucontext-stack-with-guard",
    bootstrap: "argv-env-cwd",
    resources: [
      "closed-fd",
      "inherit-stdio",
      "reopen-file",
      "pipe-buffered-bytes",
      "eventfd-counter",
      "timerfd-one-shot",
      "epoll-interest-list",
      "tcp-listener-loopback",
    ],
  };
}

function baseRestoreSummary(
  targetArch: ProductSelectedNativeArchitecture,
): Omit<
  ProductSelectedNativeRestoreSummary,
  | "state"
  | "migrationCompleted"
  | "targetVerifierResult"
  | "sourceArch"
  | "descriptorSha256"
  | "targetVerifierOutputSha256"
  | "refusal"
> {
  return {
    kind: "machinen.product-selected-native-restore-summary",
    formatVersion: PRODUCT_SELECTED_NATIVE_FORMAT_VERSION,
    runtime: "native-linux-process",
    subset: "selected-single-thread-native-workload-v1",
    supportLevel: "proof-only-product-path",
    implementationLevel: "native-product-path-e2e-gate",
    targetArch,
    publicClaimAllowed: false,
    publicClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0,
    },
    shortcutInspection: shortcutInspection(),
  };
}

function shortcutInspection(): ProductSelectedNativeRestoreSummary["shortcutInspection"] {
  return {
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    runtimeProfileRestoreUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
    metadataOnlyShortcutAccepted: false,
  };
}

function makeRefusal(
  code: ProductSelectedNativeRefusalCode,
  message: string,
  evidence: Record<string, unknown>,
): ProductSelectedNativeRefusal {
  return {
    kind: "machinen.product-selected-native-refusal",
    formatVersion: PRODUCT_SELECTED_NATIVE_FORMAT_VERSION,
    runtime: "native-linux-process",
    supportLevel: "explicit-refusal",
    state: "refused",
    migrationCompleted: false,
    expectedRefusalCode: code,
    message,
    evidence,
    arbitraryLinuxProcessSupportClaimed: false,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    runtimeProfileRestoreUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
    metadataOnlyShortcutAccepted: false,
  };
}

function withEvidence(
  refusal: ProductSelectedNativeRefusal,
  evidence: Record<string, unknown>,
): ProductSelectedNativeRefusal {
  return { ...refusal, evidence: { ...refusal.evidence, ...evidence } };
}

function readRefusal(path: string): ProductSelectedNativeRefusal {
  return JSON.parse(readFileSync(path, "utf8")) as ProductSelectedNativeRefusal;
}

function parseDescriptor(text: string): ProductSelectedNativeDescriptor {
  const descriptor = JSON.parse(text) as ProductSelectedNativeDescriptor;
  if (
    descriptor.kind !== "machinen.product-selected-native" ||
    descriptor.formatVersion !== PRODUCT_SELECTED_NATIVE_FORMAT_VERSION
  ) {
    throw new ProductSelectedNativeError(
      "NATIVE_SELECTED_DESCRIPTOR_INVALID",
      "selected native descriptor has the wrong kind or format version",
    );
  }
  return descriptor;
}

function writeRestoreSummary(
  bundleDir: string,
  dryRun: boolean | undefined,
  summary: ProductSelectedNativeRestoreSummary,
): ProductSelectedNativeRestoreSummary {
  if (dryRun !== true) {
    writeJson(join(bundleDir, PRODUCT_SELECTED_NATIVE_RESTORE_SUMMARY), summary);
  }
  return summary;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function assertNativeArch(
  value: string,
  name: string,
): asserts value is ProductSelectedNativeArchitecture {
  if (!productSelectedNativeArchitectures.includes(value as ProductSelectedNativeArchitecture)) {
    throw new ProductSelectedNativeError(
      "NATIVE_SELECTED_ARCH_INVALID",
      `${name} must be arm64 or amd64`,
    );
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256Text(value: string): string {
  return sha256Bytes(value.trim());
}

function sha256Bytes(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
