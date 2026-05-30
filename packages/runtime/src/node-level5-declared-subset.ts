import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const NODE_LEVEL5_DECLARED_SUBSET_FORMAT_VERSION = 1;
export const NODE_LEVEL5_DECLARED_SUBSET_MANIFEST = "machinen.node-level5-declared-subset-manifest";
export const NODE_LEVEL5_DECLARED_SUBSET_RESTORE_SUMMARY =
  "machinen.node-level5-declared-subset-restore-summary";

export const nodeLevel5DeclaredSubsetRefusalCodes = {
  experimentalFlagRequired: "node-level5-declared-subset-experimental-flag-required",
  outputRequired: "node-level5-declared-subset-output-required",
  manifestRequired: "node-level5-declared-subset-manifest-required",
  manifestMissing: "node-level5-declared-subset-manifest-missing",
  manifestInvalid: "node-level5-declared-subset-manifest-invalid",
  rawCpuRestoreRefused: "node-level5-declared-subset-raw-cpu-restore-refused",
  unsupportedNeighborRefused: "node-level5-declared-subset-unsupported-neighbor-refused",
  productClaimRefused: "node-level5-declared-subset-product-claim-refused",
} as const;

export type NodeLevel5DeclaredSubsetRefusalCode =
  (typeof nodeLevel5DeclaredSubsetRefusalCodes)[keyof typeof nodeLevel5DeclaredSubsetRefusalCodes];

export type NodeLevel5DeclaredSubsetArchitecture = "arm64" | "amd64";

export type NodeLevel5DeclaredSubsetRefusal = {
  code: NodeLevel5DeclaredSubsetRefusalCode;
  message: string;
};

export type NodeLevel5DeclaredSubsetSupportMatrix = {
  kind: "machinen.node-level5-declared-subset-support-matrix";
  formatVersion: typeof NODE_LEVEL5_DECLARED_SUBSET_FORMAT_VERSION;
  status: "experimental-candidate-not-supported";
  productSupportClaimed: false;
  broadLevel5ImplementationClaimed: false;
  declaredSubsetCoverage: 100;
  node: "22.x";
  v8: "12.x pointer-compressed";
  libuv: "supported idle handles only";
  supportedStateFamilies: readonly string[];
  unsupportedStateFamilies: readonly string[];
  refusalCodes: typeof nodeLevel5DeclaredSubsetRefusalCodes;
};

export const nodeLevel5DeclaredSubsetSupportMatrix: NodeLevel5DeclaredSubsetSupportMatrix = {
  kind: "machinen.node-level5-declared-subset-support-matrix",
  formatVersion: NODE_LEVEL5_DECLARED_SUBSET_FORMAT_VERSION,
  status: "experimental-candidate-not-supported",
  productSupportClaimed: false,
  broadLevel5ImplementationClaimed: false,
  declaredSubsetCoverage: 100,
  node: "22.x",
  v8: "12.x pointer-compressed",
  libuv: "supported idle handles only",
  supportedStateFamilies: [
    "idle event loop",
    "strings",
    "arrays",
    "plain objects",
    "closure contexts",
    "timers",
    "TCP listeners",
    "pipes",
    "stdio",
    "readonly files",
  ],
  unsupportedStateFamilies: [
    "worker threads",
    "active requests",
    "pending microtasks",
    "external memory",
    "Wasm modules",
    "native addons",
    "custom signal handlers",
    "raw CPU restore",
    "source ISA emulation",
  ],
  refusalCodes: nodeLevel5DeclaredSubsetRefusalCodes,
};

export type CreateNodeLevel5DeclaredSubsetCaptureInput = {
  outDir: string;
  sourceArch: NodeLevel5DeclaredSubsetArchitecture;
  targetArch: NodeLevel5DeclaredSubsetArchitecture;
  experimental: boolean;
  productSupportClaimed?: boolean;
  dryRun?: boolean;
};

export type NodeLevel5DeclaredSubsetManifest = {
  kind: typeof NODE_LEVEL5_DECLARED_SUBSET_MANIFEST;
  formatVersion: typeof NODE_LEVEL5_DECLARED_SUBSET_FORMAT_VERSION;
  status: "experimental-candidate-not-supported";
  productSupportClaimed: false;
  broadLevel5ImplementationClaimed: false;
  sourceArch: NodeLevel5DeclaredSubsetArchitecture;
  targetArch: NodeLevel5DeclaredSubsetArchitecture;
  translatedContinuationRequired: true;
  rawCpuRestoreSupported: false;
  supportMatrix: NodeLevel5DeclaredSubsetSupportMatrix;
};

export type NodeLevel5DeclaredSubsetCaptureSummary = {
  kind: "machinen.node-level5-declared-subset-capture-summary";
  accepted: boolean;
  manifestPath?: string;
  manifest?: NodeLevel5DeclaredSubsetManifest;
  dryRun: boolean;
  targetStarted: false;
  productSupportClaimed: false;
  broadLevel5ImplementationClaimed: false;
  refusal?: NodeLevel5DeclaredSubsetRefusal;
};

export type RestoreNodeLevel5DeclaredSubsetInput = {
  manifestPath: string;
  experimental: boolean;
  rawCpuRestore?: boolean;
  productSupportClaimed?: boolean;
  dryRun?: boolean;
};

export type NodeLevel5DeclaredSubsetRestoreSummary = {
  kind: typeof NODE_LEVEL5_DECLARED_SUBSET_RESTORE_SUMMARY;
  accepted: boolean;
  manifestPath: string;
  dryRun: boolean;
  targetStarted: false;
  translatedContinuationRequired: true;
  targetNativeNodeRequired: true;
  productSupportClaimed: false;
  broadLevel5ImplementationClaimed: false;
  refusal?: NodeLevel5DeclaredSubsetRefusal;
};

export function createNodeLevel5DeclaredSubsetCapture(
  input: CreateNodeLevel5DeclaredSubsetCaptureInput,
): NodeLevel5DeclaredSubsetCaptureSummary {
  const base = summaryBase(input.dryRun ?? false);
  if (!input.experimental) {
    return {
      ...base,
      kind: "machinen.node-level5-declared-subset-capture-summary",
      accepted: false,
      refusal: refusal(
        nodeLevel5DeclaredSubsetRefusalCodes.experimentalFlagRequired,
        "node-level5 declared subset capture requires --experimental-node-level5",
      ),
    };
  }
  if (input.productSupportClaimed) {
    return {
      ...base,
      kind: "machinen.node-level5-declared-subset-capture-summary",
      accepted: false,
      refusal: refusal(
        nodeLevel5DeclaredSubsetRefusalCodes.productClaimRefused,
        "node-level5 declared subset capture is experimental and must not claim product support",
      ),
    };
  }
  const manifest = buildManifest(input.sourceArch, input.targetArch);
  const manifestPath = join(input.outDir, "node-level5-declared-subset-manifest.json");
  if (!input.dryRun) {
    mkdirSync(input.outDir, { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return {
    ...base,
    kind: "machinen.node-level5-declared-subset-capture-summary",
    accepted: true,
    manifestPath,
    manifest,
  };
}

// fallow-ignore-next-line complexity
export function restoreNodeLevel5DeclaredSubset(
  input: RestoreNodeLevel5DeclaredSubsetInput,
): NodeLevel5DeclaredSubsetRestoreSummary {
  const base = restoreBase(input);
  if (!input.experimental) {
    return {
      ...base,
      accepted: false,
      refusal: refusal(
        nodeLevel5DeclaredSubsetRefusalCodes.experimentalFlagRequired,
        "node-level5 declared subset restore requires --experimental-node-level5",
      ),
    };
  }
  if (input.productSupportClaimed) {
    return {
      ...base,
      accepted: false,
      refusal: refusal(
        nodeLevel5DeclaredSubsetRefusalCodes.productClaimRefused,
        "node-level5 declared subset restore is experimental and must not claim product support",
      ),
    };
  }
  if (input.rawCpuRestore) {
    return {
      ...base,
      accepted: false,
      refusal: refusal(
        nodeLevel5DeclaredSubsetRefusalCodes.rawCpuRestoreRefused,
        "cross-architecture Node Level 5 restore must use translated continuation, not raw CPU restore",
      ),
    };
  }
  let manifest: NodeLevel5DeclaredSubsetManifest;
  try {
    manifest = JSON.parse(
      readFileSync(input.manifestPath, "utf8"),
    ) as NodeLevel5DeclaredSubsetManifest;
  } catch {
    return {
      ...base,
      accepted: false,
      refusal: refusal(
        nodeLevel5DeclaredSubsetRefusalCodes.manifestMissing,
        "node-level5 declared subset manifest was not found",
      ),
    };
  }
  if (!isNodeLevel5DeclaredSubsetManifest(manifest)) {
    return {
      ...base,
      accepted: false,
      refusal: refusal(
        nodeLevel5DeclaredSubsetRefusalCodes.manifestInvalid,
        "node-level5 declared subset manifest is invalid or outside the declared subset",
      ),
    };
  }
  return { ...base, accepted: true };
}

export function isNodeLevel5DeclaredSubsetManifest(
  value: unknown,
): value is NodeLevel5DeclaredSubsetManifest {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<NodeLevel5DeclaredSubsetManifest>;
  return (
    record.kind === NODE_LEVEL5_DECLARED_SUBSET_MANIFEST &&
    record.formatVersion === NODE_LEVEL5_DECLARED_SUBSET_FORMAT_VERSION &&
    record.status === "experimental-candidate-not-supported" &&
    record.productSupportClaimed === false &&
    record.broadLevel5ImplementationClaimed === false &&
    record.translatedContinuationRequired === true &&
    record.rawCpuRestoreSupported === false &&
    (record.sourceArch === "arm64" || record.sourceArch === "amd64") &&
    (record.targetArch === "arm64" || record.targetArch === "amd64")
  );
}

function buildManifest(
  sourceArch: NodeLevel5DeclaredSubsetArchitecture,
  targetArch: NodeLevel5DeclaredSubsetArchitecture,
): NodeLevel5DeclaredSubsetManifest {
  return {
    kind: NODE_LEVEL5_DECLARED_SUBSET_MANIFEST,
    formatVersion: NODE_LEVEL5_DECLARED_SUBSET_FORMAT_VERSION,
    status: "experimental-candidate-not-supported",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    sourceArch,
    targetArch,
    translatedContinuationRequired: true,
    rawCpuRestoreSupported: false,
    supportMatrix: nodeLevel5DeclaredSubsetSupportMatrix,
  };
}

function refusal(
  code: NodeLevel5DeclaredSubsetRefusalCode,
  message: string,
): NodeLevel5DeclaredSubsetRefusal {
  return { code, message };
}

function summaryBase(dryRun: boolean) {
  return {
    dryRun,
    targetStarted: false as const,
    productSupportClaimed: false as const,
    broadLevel5ImplementationClaimed: false as const,
  };
}

function restoreBase(
  input: RestoreNodeLevel5DeclaredSubsetInput,
): Omit<NodeLevel5DeclaredSubsetRestoreSummary, "accepted" | "refusal"> {
  return {
    kind: NODE_LEVEL5_DECLARED_SUBSET_RESTORE_SUMMARY,
    manifestPath: input.manifestPath,
    dryRun: input.dryRun ?? false,
    targetStarted: false,
    translatedContinuationRequired: true,
    targetNativeNodeRequired: true,
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
  };
}
