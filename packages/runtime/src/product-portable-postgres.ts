import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { arch as osArch, platform, release } from "node:os";
import { basename, join, resolve } from "node:path";

export const PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION = 1 as const;
export const PRODUCT_PORTABLE_POSTGRES_MANIFEST = "portable-product.json" as const;
export const PRODUCT_PORTABLE_POSTGRES_REFUSAL = "portable-product-refusal.json" as const;
export const PRODUCT_PORTABLE_POSTGRES_RESTORE_SUMMARY = "restore-summary.json" as const;
export const PRODUCT_PORTABLE_POSTGRES_DUMP = "postgres.logical.dump" as const;

export const productPortablePostgresArchitectures = ["arm64", "amd64"] as const;
export type ProductPortablePostgresArchitecture =
  (typeof productPortablePostgresArchitectures)[number];

export const productPortablePostgresSupportLevels = [
  "proof-only-fixture",
  "implemented-product-support",
  "explicit-refusal",
  "obsolete-invalid-claim",
] as const;
export type ProductPortableSupportLevel = (typeof productPortablePostgresSupportLevels)[number];

export const productPortablePostgresRefusalCodes = [
  "postgres-active-transaction-unsupported",
  "postgres-active-session-unsupported",
  "postgres-dirty-wal-boundary-unsupported",
  "postgres-host-mounted-data-dir-ambiguous",
  "postgres-physical-data-dir-cross-isa-unsupported",
  "postgres-target-arch-mismatch",
  "postgres-logical-dump-integrity-mismatch",
  "postgres-target-verifier-mismatch",
  "postgres-refused-source-state",
] as const;
export type ProductPortablePostgresRefusalCode =
  (typeof productPortablePostgresRefusalCodes)[number];

export interface ProductPortablePostgresClaimClassification {
  goal: string;
  claim: string;
  supportLevel: ProductPortableSupportLevel;
  subset?: string;
  refusalCode?: string;
  notes: string;
}

export interface ProductPortablePostgresCaptureInput {
  outDir: string;
  sourceArch: ProductPortablePostgresArchitecture;
  targetArch: ProductPortablePostgresArchitecture;
  logicalDumpPath: string;
  sourceVerifierOutput: string;
  postgresVersion: string;
  checkpointLsn: string;
  initSqlSha256?: string;
  workloadSqlSha256?: string;
  verifierSqlSha256?: string;
  dataManifestSha256?: string;
  activeTransactions?: number;
  activeSessions?: number;
  dirtyWal?: boolean;
  hostMountedDataDir?: boolean;
  physicalDataDirCopy?: boolean;
  dryRun?: boolean;
}

export interface ProductPortablePostgresDescriptor {
  kind: "machinen.product-portable-snapshot";
  formatVersion: typeof PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION;
  supportLevel: "implemented-product-support";
  subset: "postgres-clean-quiesced-logical-v1";
  runtime: "postgresql";
  captureSurface: "machinen capture postgres";
  restoreSurface: "machinen restore <bundle> --target-arch <arch> --target-verifier-output <file>";
  source: {
    architecture: ProductPortablePostgresArchitecture;
    postgresVersion: string;
    host: { arch: string; platform: string; release: string };
  };
  target: { architecture: ProductPortablePostgresArchitecture };
  artifacts: {
    logicalDump: { path: typeof PRODUCT_PORTABLE_POSTGRES_DUMP; sha256: string; bytes: number };
  };
  provenance: {
    checkpointLsn: string;
    initSqlSha256?: string;
    workloadSqlSha256?: string;
    verifierSqlSha256?: string;
    dataManifestSha256?: string;
    sourceVerifierOutputSha256: string;
  };
  gates: {
    noActiveClientTransaction: true;
    noActiveClientSession: true;
    walCheckpointed: true;
    logicalDumpIsPortableUnit: true;
    targetNativeVerificationRequired: true;
    sourceIsaEmulationAllowed: false;
    sourceTextReplayAllowed: false;
    sidecarRuntimeAllowed: false;
    appHooksAllowed: false;
    metadataOnlyContinuationAllowed: false;
  };
  sourceVerifierOutput: string;
}

export interface ProductPortablePostgresRefusal {
  kind: "machinen.product-portable-snapshot-refusal";
  formatVersion: typeof PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION;
  runtime: "postgresql";
  supportLevel: "explicit-refusal";
  state: "refused";
  migrationCompleted: false;
  expectedRefusalCode: ProductPortablePostgresRefusalCode;
  message: string;
  evidence: Record<string, unknown>;
  sourceIsaEmulationUsed: false;
  sourceTextReusedAsTargetCode: false;
  sidecarRuntimeUsed: false;
  appHooksRequired: false;
  metadataOnlyShortcutAccepted: false;
}

export type ProductPortablePostgresCaptureResult =
  | {
      state: "completed";
      migrationCompleted: true;
      bundleDir: string;
      descriptor: ProductPortablePostgresDescriptor;
      dryRun: boolean;
    }
  | {
      state: "refused";
      migrationCompleted: false;
      bundleDir: string;
      refusal: ProductPortablePostgresRefusal;
      dryRun: boolean;
    };

export interface ProductPortablePostgresRestoreInput {
  bundleDir: string;
  targetArch: ProductPortablePostgresArchitecture;
  targetVerifierOutput: string;
  dryRun?: boolean;
}

export interface ProductPortablePostgresRestoreSummary {
  kind: "machinen.product-portable-restore-summary";
  formatVersion: typeof PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION;
  runtime: "postgresql";
  subset: "postgres-clean-quiesced-logical-v1";
  supportLevel: "implemented-product-support";
  state: "completed" | "refused";
  migrationCompleted: boolean;
  sourceArch?: ProductPortablePostgresArchitecture;
  targetArch: ProductPortablePostgresArchitecture;
  targetState: "completed" | "refused";
  targetVerifierResult: "passed" | "failed" | "not-run";
  descriptorSha256?: string;
  targetVerifierOutputSha256?: string;
  refusal?: ProductPortablePostgresRefusal;
  shortcutInspection: {
    sourceIsaEmulationUsed: false;
    sourceTextReusedAsTargetCode: false;
    sidecarRuntimeUsed: false;
    appHooksRequired: false;
    metadataOnlyShortcutAccepted: false;
  };
}

export function createProductPortablePostgresSnapshot(
  input: ProductPortablePostgresCaptureInput,
): ProductPortablePostgresCaptureResult {
  assertArch(input.sourceArch, "sourceArch");
  assertArch(input.targetArch, "targetArch");
  const outDir = resolve(input.outDir);
  const refusal = sourceRefusal(input);
  if (input.dryRun !== true) {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  }
  if (refusal) {
    if (input.dryRun !== true) {
      writeJson(join(outDir, PRODUCT_PORTABLE_POSTGRES_REFUSAL), refusal);
    }
    return {
      state: "refused",
      migrationCompleted: false,
      bundleDir: outDir,
      refusal,
      dryRun: input.dryRun === true,
    };
  }
  const dumpPath = resolve(input.logicalDumpPath);
  if (!existsSync(dumpPath)) {
    throw new ProductPortablePostgresError(
      "POSTGRES_LOGICAL_DUMP_MISSING",
      `logical dump does not exist: ${dumpPath}`,
    );
  }
  const dumpBytes = readFileSync(dumpPath);
  const descriptor: ProductPortablePostgresDescriptor = {
    kind: "machinen.product-portable-snapshot",
    formatVersion: PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION,
    supportLevel: "implemented-product-support",
    subset: "postgres-clean-quiesced-logical-v1",
    runtime: "postgresql",
    captureSurface: "machinen capture postgres",
    restoreSurface:
      "machinen restore <bundle> --target-arch <arch> --target-verifier-output <file>",
    source: {
      architecture: input.sourceArch,
      postgresVersion: input.postgresVersion,
      host: { arch: osArch(), platform: platform(), release: release() },
    },
    target: { architecture: input.targetArch },
    artifacts: {
      logicalDump: {
        path: PRODUCT_PORTABLE_POSTGRES_DUMP,
        sha256: sha256(dumpBytes),
        bytes: dumpBytes.byteLength,
      },
    },
    provenance: {
      checkpointLsn: input.checkpointLsn,
      initSqlSha256: input.initSqlSha256,
      workloadSqlSha256: input.workloadSqlSha256,
      verifierSqlSha256: input.verifierSqlSha256,
      dataManifestSha256: input.dataManifestSha256,
      sourceVerifierOutputSha256: sha256(input.sourceVerifierOutput),
    },
    gates: {
      noActiveClientTransaction: true,
      noActiveClientSession: true,
      walCheckpointed: true,
      logicalDumpIsPortableUnit: true,
      targetNativeVerificationRequired: true,
      sourceIsaEmulationAllowed: false,
      sourceTextReplayAllowed: false,
      sidecarRuntimeAllowed: false,
      appHooksAllowed: false,
      metadataOnlyContinuationAllowed: false,
    },
    sourceVerifierOutput: input.sourceVerifierOutput,
  };
  if (input.dryRun !== true) {
    copyFileSync(dumpPath, join(outDir, PRODUCT_PORTABLE_POSTGRES_DUMP));
    writeJson(join(outDir, PRODUCT_PORTABLE_POSTGRES_MANIFEST), descriptor);
  }
  return {
    state: "completed",
    migrationCompleted: true,
    bundleDir: outDir,
    descriptor,
    dryRun: input.dryRun === true,
  };
}

export function restoreProductPortablePostgresSnapshot(
  input: ProductPortablePostgresRestoreInput,
): ProductPortablePostgresRestoreSummary {
  assertArch(input.targetArch, "targetArch");
  const bundleDir = resolve(input.bundleDir);
  const sourceRefusalPath = join(bundleDir, PRODUCT_PORTABLE_POSTGRES_REFUSAL);
  if (existsSync(sourceRefusalPath)) {
    const refusal = readRefusal(sourceRefusalPath);
    return writeRestoreSummary(bundleDir, input.dryRun, {
      kind: "machinen.product-portable-restore-summary",
      formatVersion: PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION,
      runtime: "postgresql",
      subset: "postgres-clean-quiesced-logical-v1",
      supportLevel: "implemented-product-support",
      state: "refused",
      migrationCompleted: false,
      targetArch: input.targetArch,
      targetState: "refused",
      targetVerifierResult: "not-run",
      refusal: withEvidence(refusal, { restoreReason: "source capture was refused" }),
      shortcutInspection: shortcutInspection(),
    });
  }
  const descriptorPath = join(bundleDir, PRODUCT_PORTABLE_POSTGRES_MANIFEST);
  if (!existsSync(descriptorPath)) {
    throw new ProductPortablePostgresError(
      "POSTGRES_PORTABLE_DESCRIPTOR_MISSING",
      `portable product descriptor is missing: ${descriptorPath}`,
    );
  }
  const descriptorText = readFileSync(descriptorPath, "utf8");
  const descriptor = parseDescriptor(descriptorText, descriptorPath);
  const descriptorSha256 = sha256(descriptorText);
  const targetVerifierOutputSha256 = sha256(input.targetVerifierOutput);
  const refusal = restoreRefusal(
    bundleDir,
    descriptor,
    input.targetArch,
    input.targetVerifierOutput,
  );
  if (refusal) {
    return writeRestoreSummary(bundleDir, input.dryRun, {
      kind: "machinen.product-portable-restore-summary",
      formatVersion: PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION,
      runtime: "postgresql",
      subset: "postgres-clean-quiesced-logical-v1",
      supportLevel: "implemented-product-support",
      state: "refused",
      migrationCompleted: false,
      sourceArch: descriptor.source.architecture,
      targetArch: input.targetArch,
      targetState: "refused",
      targetVerifierResult: "failed",
      descriptorSha256,
      targetVerifierOutputSha256,
      refusal,
      shortcutInspection: shortcutInspection(),
    });
  }
  return writeRestoreSummary(bundleDir, input.dryRun, {
    kind: "machinen.product-portable-restore-summary",
    formatVersion: PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION,
    runtime: "postgresql",
    subset: "postgres-clean-quiesced-logical-v1",
    supportLevel: "implemented-product-support",
    state: "completed",
    migrationCompleted: true,
    sourceArch: descriptor.source.architecture,
    targetArch: input.targetArch,
    targetState: "completed",
    targetVerifierResult: "passed",
    descriptorSha256,
    targetVerifierOutputSha256,
    shortcutInspection: shortcutInspection(),
  });
}

export function isProductPortablePostgresBundle(dir: string): boolean {
  return (
    existsSync(join(resolve(dir), PRODUCT_PORTABLE_POSTGRES_MANIFEST)) ||
    existsSync(join(resolve(dir), PRODUCT_PORTABLE_POSTGRES_REFUSAL))
  );
}

export function productPortablePostgresFileSha256(path: string): string {
  return sha256(readFileSync(path));
}

export class ProductPortablePostgresError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProductPortablePostgresError";
  }
}

function sourceRefusal(
  input: ProductPortablePostgresCaptureInput,
): ProductPortablePostgresRefusal | undefined {
  if ((input.activeTransactions ?? 0) > 0) {
    return refusal(
      "postgres-active-transaction-unsupported",
      "active PostgreSQL transaction at capture time",
      {
        activeTransactions: input.activeTransactions,
      },
    );
  }
  if ((input.activeSessions ?? 0) > 0) {
    return refusal(
      "postgres-active-session-unsupported",
      "active PostgreSQL client session at capture time",
      {
        activeSessions: input.activeSessions,
      },
    );
  }
  if (input.dirtyWal === true) {
    return refusal(
      "postgres-dirty-wal-boundary-unsupported",
      "dirty WAL without a recorded checkpoint boundary",
      {},
    );
  }
  if (input.hostMountedDataDir === true) {
    return refusal(
      "postgres-host-mounted-data-dir-ambiguous",
      "host-mounted PostgreSQL data directory has ambiguous flush/ownership semantics",
      {},
    );
  }
  if (input.physicalDataDirCopy === true) {
    return refusal(
      "postgres-physical-data-dir-cross-isa-unsupported",
      "physical data-directory/WAL byte copy is not a portable amd64<->arm64 unit",
      {},
    );
  }
  return undefined;
}

function restoreRefusal(
  bundleDir: string,
  descriptor: ProductPortablePostgresDescriptor,
  targetArch: ProductPortablePostgresArchitecture,
  targetVerifierOutput: string,
): ProductPortablePostgresRefusal | undefined {
  if (descriptor.target.architecture !== targetArch) {
    return refusal(
      "postgres-target-arch-mismatch",
      "restore target architecture does not match descriptor",
      {
        expected: descriptor.target.architecture,
        actual: targetArch,
      },
    );
  }
  const dumpPath = join(bundleDir, descriptor.artifacts.logicalDump.path);
  if (
    !existsSync(dumpPath) ||
    productPortablePostgresFileSha256(dumpPath) !== descriptor.artifacts.logicalDump.sha256
  ) {
    return refusal(
      "postgres-logical-dump-integrity-mismatch",
      "logical dump digest does not match descriptor",
      {
        artifact: basename(dumpPath),
      },
    );
  }
  if (targetVerifierOutput !== descriptor.sourceVerifierOutput) {
    return refusal(
      "postgres-target-verifier-mismatch",
      "target-native PostgreSQL verifier output did not match source",
      {
        sourceVerifierOutputSha256: descriptor.provenance.sourceVerifierOutputSha256,
        targetVerifierOutputSha256: sha256(targetVerifierOutput),
      },
    );
  }
  return undefined;
}

function parseDescriptor(text: string, path: string): ProductPortablePostgresDescriptor {
  const value = JSON.parse(text) as Partial<ProductPortablePostgresDescriptor>;
  if (value.kind !== "machinen.product-portable-snapshot") {
    throw new ProductPortablePostgresError(
      "POSTGRES_PORTABLE_DESCRIPTOR_INVALID",
      `${path}: invalid kind`,
    );
  }
  if (value.formatVersion !== PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION) {
    throw new ProductPortablePostgresError(
      "POSTGRES_PORTABLE_DESCRIPTOR_INVALID",
      `${path}: unsupported formatVersion`,
    );
  }
  if (value.supportLevel !== "implemented-product-support") {
    throw new ProductPortablePostgresError(
      "POSTGRES_PORTABLE_DESCRIPTOR_INVALID",
      `${path}: supportLevel must be implemented-product-support`,
    );
  }
  assertArch(value.source?.architecture, "descriptor.source.architecture");
  assertArch(value.target?.architecture, "descriptor.target.architecture");
  if (value.runtime !== "postgresql" || value.subset !== "postgres-clean-quiesced-logical-v1") {
    throw new ProductPortablePostgresError(
      "POSTGRES_PORTABLE_DESCRIPTOR_INVALID",
      `${path}: unsupported runtime/subset`,
    );
  }
  return value as ProductPortablePostgresDescriptor;
}

function readRefusal(path: string): ProductPortablePostgresRefusal {
  const value = JSON.parse(readFileSync(path, "utf8")) as ProductPortablePostgresRefusal;
  if (value.kind !== "machinen.product-portable-snapshot-refusal") {
    throw new ProductPortablePostgresError(
      "POSTGRES_PORTABLE_REFUSAL_INVALID",
      `${path}: invalid refusal kind`,
    );
  }
  return value;
}

function withEvidence(
  input: ProductPortablePostgresRefusal,
  evidence: Record<string, unknown>,
): ProductPortablePostgresRefusal {
  return { ...input, evidence: { ...input.evidence, ...evidence } };
}

function refusal(
  code: ProductPortablePostgresRefusalCode,
  message: string,
  evidence: Record<string, unknown>,
): ProductPortablePostgresRefusal {
  return {
    kind: "machinen.product-portable-snapshot-refusal",
    formatVersion: PRODUCT_PORTABLE_POSTGRES_FORMAT_VERSION,
    runtime: "postgresql",
    supportLevel: "explicit-refusal",
    state: "refused",
    migrationCompleted: false,
    expectedRefusalCode: code,
    message,
    evidence,
    sourceIsaEmulationUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
    metadataOnlyShortcutAccepted: false,
  };
}

function writeRestoreSummary(
  bundleDir: string,
  dryRun: boolean | undefined,
  summary: ProductPortablePostgresRestoreSummary,
): ProductPortablePostgresRestoreSummary {
  if (dryRun !== true) {
    writeJson(join(resolve(bundleDir), PRODUCT_PORTABLE_POSTGRES_RESTORE_SUMMARY), summary);
  }
  return summary;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function shortcutInspection(): ProductPortablePostgresRestoreSummary["shortcutInspection"] {
  return {
    sourceIsaEmulationUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
    metadataOnlyShortcutAccepted: false,
  };
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertArch(
  value: unknown,
  field: string,
): asserts value is ProductPortablePostgresArchitecture {
  if (value !== "arm64" && value !== "amd64") {
    throw new ProductPortablePostgresError(
      "POSTGRES_PORTABLE_ARCH_INVALID",
      `${field} must be arm64 or amd64`,
    );
  }
}
