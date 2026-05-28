export const PRODUCT_CLAIM_REGISTRY_FORMAT_VERSION = 1 as const;

export const productClaimStatuses = [
  "implemented-product-support",
  "stable-product-refusal",
  "proof-only-fixture",
  "obsolete-invalid-claim",
] as const;
export type ProductClaimStatus = (typeof productClaimStatuses)[number];

export const productClaimFamilies = [
  "postgresql",
  "nodejs",
  "go",
  "python-ruby-jvm",
  "stateful-services",
  "foundation-native",
  "native-linux-resource",
  "network-ping-socket",
  "unknown",
] as const;
export type ProductClaimFamily = (typeof productClaimFamilies)[number];

export const PRODUCT_CLAIM_PROOF_ONLY_REFUSAL_CODE = "product-surface-not-implemented" as const;

export interface ProductClaimProofProfileInput {
  name: string;
  description?: string;
  expectedResult?: "success" | "refusal" | string;
  supportStatus?: string;
  unsafeStateFamily?: string;
  expectedRefusalCode?: string;
  capabilities?: string[];
  refusesCapabilities?: string[];
  refusalSupportContract?: { currentRefusalCode?: string; graduationRequires?: string[] };
  checkedSummary?: string;
  sourceFixture?: string;
}

export interface ProductClaimEntry {
  name: string;
  family: ProductClaimFamily;
  runtime?: string;
  resourceFamily?: string;
  architectureRoutes: Array<"arm64->amd64" | "amd64->arm64" | "amd64<->arm64">;
  productStatus: ProductClaimStatus;
  proofStatus: string;
  expectedResult: "success" | "refusal" | "unknown";
  sourceGoal?: string;
  unsafeStateFamily?: string;
  refusalCode?: string;
  productRefusalCode?: string;
  migrationCompleted: boolean;
  descriptorRequired: boolean;
  targetNativeVerifierRequired: boolean;
  proofOnly: boolean;
  checkedSummary?: string;
  sourceFixture?: string;
  graduationRequirements: string[];
  message: string;
}

export interface ProductClaimRegistry {
  kind: "machinen.product-claim-registry";
  formatVersion: typeof PRODUCT_CLAIM_REGISTRY_FORMAT_VERSION;
  entries: ProductClaimEntry[];
  summary: ProductClaimRegistrySummary;
}

export interface ProductClaimRegistrySummary {
  total: number;
  byStatus: Record<ProductClaimStatus, number>;
  byFamily: Record<ProductClaimFamily, number>;
  implementedProductSupport: number;
  stableProductRefusals: number;
  proofOnlyFixtures: number;
  obsoleteInvalidClaims: number;
}

export interface ProductClaimRegistryFilter {
  status?: ProductClaimStatus;
  family?: ProductClaimFamily;
  runtime?: string;
  resourceFamily?: string;
  profile?: string;
  refusalCode?: string;
}

const IMPLEMENTED_PRODUCT_PROFILES = new Set([
  "node-app-http-server-recreate",
  "python-cross-arch-runtime-policy",
  "go-cross-arch-runtime-policy",
]);

const FAMILY_RUNTIME: Record<ProductClaimFamily, string | undefined> = {
  postgresql: "postgresql",
  nodejs: "nodejs",
  go: "go",
  "python-ruby-jvm": undefined,
  "stateful-services": undefined,
  "foundation-native": undefined,
  "native-linux-resource": undefined,
  "network-ping-socket": undefined,
  unknown: undefined,
};

export function buildProductClaimRegistry(
  proofProfiles: ProductClaimProofProfileInput[],
): ProductClaimRegistry {
  const entries = proofProfiles
    .map(productClaimEntryFromProofProfile)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    kind: "machinen.product-claim-registry",
    formatVersion: PRODUCT_CLAIM_REGISTRY_FORMAT_VERSION,
    entries,
    summary: summarizeProductClaimRegistry(entries),
  };
}

export function productClaimEntryFromProofProfile(
  profile: ProductClaimProofProfileInput,
): ProductClaimEntry {
  const family = classifyProductClaimFamily(profile);
  const implemented = IMPLEMENTED_PRODUCT_PROFILES.has(profile.name);
  const expectedResult =
    profile.expectedResult === "success" || profile.expectedResult === "refusal"
      ? profile.expectedResult
      : "unknown";
  const refusalCode =
    profile.expectedRefusalCode ?? profile.refusalSupportContract?.currentRefusalCode;
  const productStatus = implemented
    ? "implemented-product-support"
    : expectedResult === "refusal"
      ? "stable-product-refusal"
      : "proof-only-fixture";
  const productRefusalCode = implemented
    ? undefined
    : (refusalCode ?? PRODUCT_CLAIM_PROOF_ONLY_REFUSAL_CODE);
  return {
    name: profile.name,
    family,
    runtime: runtimeForProfile(profile, family),
    resourceFamily: resourceFamilyForProfile(profile, family),
    architectureRoutes: ["amd64<->arm64"],
    productStatus,
    proofStatus: profile.supportStatus ?? "unknown",
    expectedResult,
    sourceGoal: sourceGoal(profile),
    unsafeStateFamily: profile.unsafeStateFamily,
    refusalCode,
    productRefusalCode,
    migrationCompleted: implemented,
    descriptorRequired: implemented,
    targetNativeVerifierRequired: implemented,
    proofOnly: !implemented,
    checkedSummary: profile.checkedSummary,
    sourceFixture: profile.sourceFixture,
    graduationRequirements: implemented
      ? []
      : (profile.refusalSupportContract?.graduationRequires ??
        defaultGraduationRequirements(profile)),
    message: productClaimMessage(profile, productStatus, productRefusalCode),
  };
}

export function summarizeProductClaimRegistry(
  entries: ProductClaimEntry[],
): ProductClaimRegistrySummary {
  const byStatus = Object.fromEntries(productClaimStatuses.map((status) => [status, 0])) as Record<
    ProductClaimStatus,
    number
  >;
  const byFamily = Object.fromEntries(productClaimFamilies.map((family) => [family, 0])) as Record<
    ProductClaimFamily,
    number
  >;
  for (const entry of entries) {
    byStatus[entry.productStatus] += 1;
    byFamily[entry.family] += 1;
  }
  return {
    total: entries.length,
    byStatus,
    byFamily,
    implementedProductSupport: byStatus["implemented-product-support"],
    stableProductRefusals: byStatus["stable-product-refusal"],
    proofOnlyFixtures: byStatus["proof-only-fixture"],
    obsoleteInvalidClaims: byStatus["obsolete-invalid-claim"],
  };
}

export function filterProductClaimRegistry(
  entries: ProductClaimEntry[],
  filter: ProductClaimRegistryFilter,
): ProductClaimEntry[] {
  // fallow-ignore-next-line complexity
  return entries.filter((entry) => {
    if (filter.status && entry.productStatus !== filter.status) {
      return false;
    }
    if (filter.family && entry.family !== filter.family) {
      return false;
    }
    if (filter.runtime && entry.runtime !== filter.runtime) {
      return false;
    }
    if (filter.resourceFamily && entry.resourceFamily !== filter.resourceFamily) {
      return false;
    }
    if (filter.profile && entry.name !== filter.profile) {
      return false;
    }
    if (
      filter.refusalCode &&
      entry.productRefusalCode !== filter.refusalCode &&
      entry.refusalCode !== filter.refusalCode
    ) {
      return false;
    }
    return true;
  });
}

export function productClaimRefusalSummary(entry: ProductClaimEntry):
  | {
      state: "refused";
      targetState: "refused";
      migrationCompleted: false;
      expectedRefusalCode: string;
      message: string;
      graduationRequirements: string[];
    }
  | undefined {
  if (entry.productStatus === "implemented-product-support") {
    return undefined;
  }
  return {
    state: "refused",
    targetState: "refused",
    migrationCompleted: false,
    expectedRefusalCode: entry.productRefusalCode ?? PRODUCT_CLAIM_PROOF_ONLY_REFUSAL_CODE,
    message: entry.message,
    graduationRequirements: entry.graduationRequirements,
  };
}

// fallow-ignore-next-line complexity
function classifyProductClaimFamily(profile: ProductClaimProofProfileInput): ProductClaimFamily {
  const haystack = profileHaystack(profile);
  if (haystack.includes("postgres")) {
    return "postgresql";
  }
  if (haystack.includes("runtime:node") || profile.name.startsWith("node")) {
    return "nodejs";
  }
  if (
    haystack.includes("runtime:python") ||
    haystack.includes("runtime:ruby") ||
    haystack.includes("runtime:jvm") ||
    haystack.includes("python") ||
    haystack.includes("ruby") ||
    haystack.includes("jvm") ||
    haystack.includes("jni")
  ) {
    return "python-ruby-jvm";
  }
  if (
    haystack.includes("runtime:go") ||
    haystack.includes("go-service") ||
    haystack.includes("go-quiescent") ||
    haystack.startsWith("go-")
  ) {
    return "go";
  }
  if (
    haystack.includes("redis") ||
    haystack.includes("sqlite") ||
    haystack.includes("mysql") ||
    haystack.includes("mariadb") ||
    haystack.includes("durable-queue") ||
    haystack.includes("filesystem-backed") ||
    haystack.includes("append-only")
  ) {
    return "stateful-services";
  }
  if (
    haystack.includes("ping") ||
    haystack.includes("icmp") ||
    haystack.includes("tcp") ||
    haystack.includes("socket") ||
    haystack.includes("tls") ||
    haystack.includes("bpf") ||
    haystack.includes("epoll") ||
    haystack.includes("accept")
  ) {
    return "network-ping-socket";
  }
  if (
    haystack.includes("futex") ||
    haystack.includes("eventfd") ||
    haystack.includes("timerfd") ||
    haystack.includes("memfd") ||
    haystack.includes("inotify") ||
    haystack.includes("fanotify") ||
    haystack.includes("io-uring") ||
    haystack.includes("pidfd") ||
    haystack.includes("clone") ||
    haystack.includes("seccomp") ||
    haystack.includes("landlock") ||
    haystack.includes("cgroup") ||
    haystack.includes("namespace") ||
    haystack.includes("rlimit") ||
    haystack.includes("prctl") ||
    haystack.includes("pty") ||
    haystack.includes("termios") ||
    haystack.includes("signalfd") ||
    haystack.includes("sysv") ||
    haystack.includes("rseq") ||
    haystack.includes("shared-memory")
  ) {
    return "native-linux-resource";
  }
  if (
    haystack.includes("descriptor") ||
    haystack.includes("register") ||
    haystack.includes("stack") ||
    haystack.includes("memory") ||
    haystack.includes("return-chain") ||
    haystack.includes("target-guest") ||
    haystack.includes("native") ||
    haystack.includes("process") ||
    haystack.includes("executable") ||
    haystack.includes("continuation") ||
    haystack.includes("syscall") ||
    haystack.includes("dwarf") ||
    haystack.includes("unwind")
  ) {
    return "foundation-native";
  }
  return "unknown";
}

function runtimeForProfile(
  profile: ProductClaimProofProfileInput,
  family: ProductClaimFamily,
): string | undefined {
  const haystack = profileHaystack(profile);
  if (family === "python-ruby-jvm") {
    if (haystack.includes("python")) {
      return "python";
    }
    if (haystack.includes("ruby")) {
      return "ruby";
    }
    if (haystack.includes("jvm") || haystack.includes("jni")) {
      return "jvm";
    }
  }
  if (family === "stateful-services") {
    for (const runtime of [
      "redis",
      "sqlite",
      "mysql",
      "mariadb",
      "durable-queue",
      "filesystem",
    ] as const) {
      if (haystack.includes(runtime)) {
        return runtime;
      }
    }
  }
  return FAMILY_RUNTIME[family];
}

function resourceFamilyForProfile(
  profile: ProductClaimProofProfileInput,
  family: ProductClaimFamily,
): string | undefined {
  if (profile.unsafeStateFamily) {
    return profile.unsafeStateFamily.split(":")[0];
  }
  const capabilities = [...(profile.capabilities ?? []), ...(profile.refusesCapabilities ?? [])];
  const resourceCapability = capabilities.find((capability) => capability.includes(":"));
  if (resourceCapability) {
    return resourceCapability.split(":").slice(0, 2).join(":");
  }
  return family === "unknown" ? undefined : family;
}

function sourceGoal(profile: ProductClaimProofProfileInput): string | undefined {
  const text = `${profile.description ?? ""} ${profile.sourceFixture ?? ""}`;
  const match = /goal[- ]?(\d+(?:\.\d+)?)/iu.exec(text);
  return match ? `goal-${match[1]}` : undefined;
}

function productClaimMessage(
  profile: ProductClaimProofProfileInput,
  status: ProductClaimStatus,
  productRefusalCode: string | undefined,
): string {
  if (status === "implemented-product-support") {
    return "Implemented product support with descriptor integrity checks and target-native verification.";
  }
  if (status === "stable-product-refusal") {
    return `Product restore is refused with ${productRefusalCode}; the proof/refusal profile remains fail-closed with migrationCompleted=false.`;
  }
  if (status === "proof-only-fixture") {
    return "Proof-only fixture retained for regression coverage; no product capture/restore surface is implemented, so product restore is refused.";
  }
  return `Claim is obsolete or invalid and must not be surfaced as support: ${profile.name}`;
}

function defaultGraduationRequirements(profile: ProductClaimProofProfileInput): string[] {
  if (profile.expectedResult === "success") {
    return [
      "product-descriptor-contract",
      "product-capture-surface",
      "product-restore-surface",
      "target-native-verifier",
      "proof-vs-product-regression-test",
    ];
  }
  return ["portable-state-model", "descriptor-gate", "target-gates", "neighbor-specific-verifier"];
}

function profileHaystack(profile: ProductClaimProofProfileInput): string {
  return [
    profile.name,
    profile.description,
    profile.unsafeStateFamily,
    profile.sourceFixture,
    ...(profile.capabilities ?? []),
    ...(profile.refusesCapabilities ?? []),
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}
