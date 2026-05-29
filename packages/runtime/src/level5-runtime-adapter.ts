export const LEVEL5_RUNTIME_ADAPTER_SUBSTRATE_FORMAT_VERSION = 1 as const;

export type Level5EvidenceStatus = "proof" | "support" | "refusal";
export type Level5ProductSupport = "supported" | "not-yet-supported" | "unsupported";
export type Level5ImplementationLevel =
  | "not-implemented"
  | "level-0-fail-closed-discovery"
  | "level-5-cross-arch-process-continuation-substrate"
  | "level-5-cross-arch-process-continuation";
export type Level5GraduationTargetLevel = "level-5-cross-arch-process-continuation";
export type Level5AdapterOperation = "snapshot" | "restore";
export type Level5RuntimeFamily = "node" | "go" | "jvm" | "python" | "ruby" | "native" | string;

export const level5SubstrateRefusalCodes = [
  "level5-runtime-family-unsupported",
  "level5-runtime-profile-unsupported",
  "level5-target-native-runtime-missing",
  "level5-source-target-arch-unsupported",
  "level5-source-isa-emulation-forbidden",
  "level5-sidecar-output-forbidden",
  "level5-metadata-only-success-forbidden",
  "level5-active-syscall-unsupported",
  "level5-active-tcp-stream-unsupported",
  "level5-thread-state-unsupported",
  "level5-kernel-resource-unsupported",
  "level5-runtime-heap-stack-unsupported",
] as const;

export type Level5SubstrateRefusalCode = (typeof level5SubstrateRefusalCodes)[number];

export interface Level5StatusFields {
  evidenceStatus: Level5EvidenceStatus;
  productSupport: Level5ProductSupport;
  implementationLevel: Level5ImplementationLevel;
  graduationTargetLevel: Level5GraduationTargetLevel;
  migrationCompleted: boolean;
}

export interface Level5ArchitectureMetadata {
  sourceArch?: "arm64" | "amd64" | string;
  targetArch?: "arm64" | "amd64" | string;
}

export interface Level5ArtifactEnvelope extends Level5StatusFields, Level5ArchitectureMetadata {
  kind: string;
  formatVersion: typeof LEVEL5_RUNTIME_ADAPTER_SUBSTRATE_FORMAT_VERSION | number;
  adapterId: string;
  runtimeFamily: Level5RuntimeFamily;
  profile: string;
}

export interface Level5AdapterDetectInput {
  operation: Level5AdapterOperation;
  snapDir?: string;
  bundleFiles?: string[];
  runtimeFamily?: Level5RuntimeFamily;
  profile?: string;
  artifactKind?: string;
}

export interface Level5AdapterDetection {
  matched: boolean;
  adapterId: string;
  runtimeFamily: Level5RuntimeFamily;
  profile?: string;
  reason: string;
}

export interface Level5QuiesceResult {
  state: "quiesced" | "refused";
  refusals: Level5RefusalEnvelope[];
}

export interface Level5ValidationResult {
  state: "passed" | "refused";
  refusals: Level5RefusalEnvelope[];
}

export interface Level5RestorePlan extends Level5ArtifactEnvelope {
  kind: "machinen.level5-restore-plan";
  planState: "planned" | "refused";
  steps: string[];
  refusals: Level5RefusalEnvelope[];
}

export interface Level5VerifierEvidence extends Level5StatusFields {
  kind: "machinen.level5-target-verifier-evidence" | string;
  status: "passed" | "failed" | "not-run";
  targetNativeExecution: boolean;
  sourceIsaEmulationUsed: boolean;
  sidecarOutputUsed: boolean;
  metadataOnlySuccess: boolean;
  message: string;
}

export interface Level5RefusalEnvelope extends Level5StatusFields {
  kind: "machinen.level5-refusal";
  code: Level5SubstrateRefusalCode | string;
  message: string;
  adapterId?: string;
  runtimeFamily?: Level5RuntimeFamily;
  profile?: string;
  stable: true;
}

export interface Level5RuntimeAdapter<
  SnapshotContext = unknown,
  CaptureArtifact = unknown,
  RestoreContext = unknown,
  Plan extends Level5RestorePlan = Level5RestorePlan,
  RestoreResult = unknown,
  VerifyEvidence extends Level5VerifierEvidence = Level5VerifierEvidence,
> {
  id: string;
  runtimeFamily: Level5RuntimeFamily;
  supportedProfiles: readonly string[];
  graduationTargetLevel: Level5GraduationTargetLevel;
  detect(input: Level5AdapterDetectInput): Level5AdapterDetection;
  quiesce(input: SnapshotContext): Level5QuiesceResult | Promise<Level5QuiesceResult>;
  capture(input: SnapshotContext): CaptureArtifact | Promise<CaptureArtifact>;
  validate(
    input: CaptureArtifact | RestoreContext,
  ): Level5ValidationResult | Promise<Level5ValidationResult>;
  planRestore(input: RestoreContext): Plan | Promise<Plan>;
  restoreTargetNative(input: Plan): RestoreResult | Promise<RestoreResult>;
  verify(input: RestoreResult): VerifyEvidence | Promise<VerifyEvidence>;
  refuse(input: {
    code: Level5SubstrateRefusalCode | string;
    message: string;
    profile?: string;
  }): Level5RefusalEnvelope;
}

export interface Level5RuntimeAdapterMatch<
  Adapter extends Level5RuntimeAdapter = Level5RuntimeAdapter,
> {
  adapter: Adapter;
  detection: Level5AdapterDetection;
}

export interface Level5RuntimeAdapterRegistry<
  Adapter extends Level5RuntimeAdapter = Level5RuntimeAdapter,
> {
  adapters: readonly Adapter[];
  detect(input: Level5AdapterDetectInput): Level5RuntimeAdapterMatch<Adapter> | undefined;
  refuseUnsupported(input: {
    code?: Level5SubstrateRefusalCode;
    message: string;
    runtimeFamily?: Level5RuntimeFamily;
    profile?: string;
  }): Level5RefusalEnvelope;
  summary(): Level5RuntimeAdapterRegistrySummary;
}

export interface Level5RuntimeAdapterRegistrySummary extends Level5StatusFields {
  kind: "machinen.level5-runtime-adapter-registry-summary";
  formatVersion: typeof LEVEL5_RUNTIME_ADAPTER_SUBSTRATE_FORMAT_VERSION;
  adapterCount: number;
  adapters: Array<{
    id: string;
    runtimeFamily: Level5RuntimeFamily;
    supportedProfiles: readonly string[];
    graduationTargetLevel: Level5GraduationTargetLevel;
  }>;
  stableRefusalCodes: readonly Level5SubstrateRefusalCode[];
}

export function createLevel5RuntimeAdapterRegistry<Adapter extends Level5RuntimeAdapter>(
  adapters: readonly Adapter[],
): Level5RuntimeAdapterRegistry<Adapter> {
  return {
    adapters,
    detect(input) {
      for (const adapter of adapters) {
        const detection = adapter.detect(input);
        if (detection.matched) {
          return { adapter, detection };
        }
      }
      return undefined;
    },
    refuseUnsupported(input) {
      return buildLevel5RefusalEnvelope({
        code: input.code ?? "level5-runtime-family-unsupported",
        message: input.message,
        runtimeFamily: input.runtimeFamily,
        profile: input.profile,
      });
    },
    summary() {
      return buildLevel5RuntimeAdapterRegistrySummary(adapters);
    },
  };
}

export function buildLevel5RefusalEnvelope(input: {
  code: Level5SubstrateRefusalCode | string;
  message: string;
  adapterId?: string;
  runtimeFamily?: Level5RuntimeFamily;
  profile?: string;
}): Level5RefusalEnvelope {
  return {
    kind: "machinen.level5-refusal",
    code: input.code,
    message: input.message,
    ...(input.adapterId ? { adapterId: input.adapterId } : {}),
    ...(input.runtimeFamily ? { runtimeFamily: input.runtimeFamily } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    evidenceStatus: "refusal",
    productSupport: "unsupported",
    implementationLevel: "level-0-fail-closed-discovery",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    migrationCompleted: false,
    stable: true,
  };
}

export function buildLevel5ProofOnlyStatus(): Level5StatusFields {
  return {
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    migrationCompleted: false,
  };
}

export function buildLevel5RuntimeAdapterRegistrySummary(
  adapters: readonly Pick<
    Level5RuntimeAdapter,
    "id" | "runtimeFamily" | "supportedProfiles" | "graduationTargetLevel"
  >[],
): Level5RuntimeAdapterRegistrySummary {
  return {
    kind: "machinen.level5-runtime-adapter-registry-summary",
    formatVersion: LEVEL5_RUNTIME_ADAPTER_SUBSTRATE_FORMAT_VERSION,
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "level-5-cross-arch-process-continuation-substrate",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    migrationCompleted: false,
    adapterCount: adapters.length,
    adapters: adapters.map((adapter) => ({
      id: adapter.id,
      runtimeFamily: adapter.runtimeFamily,
      supportedProfiles: adapter.supportedProfiles,
      graduationTargetLevel: adapter.graduationTargetLevel,
    })),
    stableRefusalCodes: level5SubstrateRefusalCodes,
  };
}
