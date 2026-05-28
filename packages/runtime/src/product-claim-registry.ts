export const PRODUCT_CLAIM_REGISTRY_FORMAT_VERSION = 1 as const;

export const productSupportLevels = [
  "level-0-fail-closed-discovery",
  "level-1-semantic-restart",
  "level-2-semantic-continuation",
  "level-3-runtime-aware-continuation",
  "level-4-kernel-resource-reconstruction",
  "level-5-cross-arch-process-continuation",
] as const;
export type ProductSupportLevel = (typeof productSupportLevels)[number];

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

export interface ProductClaimObservableStateDecision {
  name: string;
  decision:
    | "preserved"
    | "recreated"
    | "drained"
    | "dropped-irrelevant"
    | "logically-restored"
    | "refused";
  rationale: string;
}

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
  productSupportLevel?: ProductSupportLevel;
  observableStateDecisions?: ProductClaimObservableStateDecision[];
}

export interface ProductClaimEntry {
  name: string;
  family: ProductClaimFamily;
  runtime?: string;
  resourceFamily?: string;
  architectureRoutes: Array<"arm64->amd64" | "amd64->arm64" | "amd64<->arm64">;
  productStatus: ProductClaimStatus;
  supportLevel: ProductSupportLevel;
  supportLevelName: string;
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
  observableStateDecisions: ProductClaimObservableStateDecision[];
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
  supportLevel?: ProductSupportLevel;
}

const IMPLEMENTED_PRODUCT_PROFILES = new Set([
  "node-app-http-server-recreate",
  "python-cross-arch-runtime-policy",
  "go-cross-arch-runtime-policy",
  "ping-sequence-counter-semantic-continuation-v1",
]);

const BUILTIN_PRODUCT_PROFILES: ProductClaimProofProfileInput[] = [
  {
    name: "ping-sequence-counter-semantic-continuation-v1",
    description:
      "Goal 001 Level 2 semantic continuation: ping resumes target-natively at a recorded sequence boundary with logical sent/received/lost counters and an explicit drop-and-count-lost in-flight packet policy.",
    sourceFixture: "product-semantic-ping:ping-sequence-counter-semantic-continuation-v1",
    expectedResult: "success",
    supportStatus: "implemented-semantic-continuation",
    productSupportLevel: "level-2-semantic-continuation",
    unsafeStateFamily: "semantic-ping-sequence-counter-v1",
    capabilities: [
      "goal001:level-2-semantic-continuation",
      "goal001:semantic-ping-sequence-counter-v1",
      "goal001:target-native-verifier",
    ],
    observableStateDecisions: [
      {
        name: "destination",
        decision: "preserved",
        rationale: "the descriptor carries the destination into the target ping operation",
      },
      {
        name: "identifier-and-next-sequence",
        decision: "logically-restored",
        rationale: "the target resumes at the next recorded sequence boundary",
      },
      {
        name: "sent-received-lost-counters",
        decision: "logically-restored",
        rationale:
          "counters are carried as logical integers and advanced only after target verifier replies",
      },
      {
        name: "target-ping-process",
        decision: "recreated",
        rationale:
          "the source process is not teleported; the target uses target-native ping semantics",
      },
      {
        name: "receive-queue",
        decision: "drained",
        rationale: "the accepted profile requires no unread replies at the snapshot boundary",
      },
      {
        name: "raw-socket-kernel-state",
        decision: "refused",
        rationale: "kernel-exact socket state is outside the Level 2 semantic descriptor",
      },
    ],
    checkedSummary: "scripts/smoke/semantic-ping-continuation.sh",
    refusalSupportContract: {
      currentRefusalCode: "semantic-ping-unread-receive-queue-unsupported",
      graduationRequires: [
        "receive-queue-descriptor",
        "active-recvmsg-model",
        "raw-socket-target-recreate",
        "live-icmp-vm-smoke",
      ],
    },
  },
];

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
  const entries = [...proofProfiles, ...BUILTIN_PRODUCT_PROFILES]
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
  const supportLevel = productSupportLevelForProfile(profile, productStatus);
  return {
    name: profile.name,
    family,
    runtime: runtimeForProfile(profile, family),
    resourceFamily: resourceFamilyForProfile(profile, family),
    architectureRoutes: ["amd64<->arm64"],
    productStatus,
    supportLevel,
    supportLevelName: productSupportLevelName(supportLevel),
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
    observableStateDecisions:
      profile.observableStateDecisions ?? defaultObservableStateDecisions(profile, supportLevel),
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
    if (filter.supportLevel && entry.supportLevel !== filter.supportLevel) {
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
function productSupportLevelForProfile(
  profile: ProductClaimProofProfileInput,
  status: ProductClaimStatus,
): ProductSupportLevel {
  if (profile.productSupportLevel) {
    return profile.productSupportLevel;
  }
  if (status !== "implemented-product-support") {
    return "level-0-fail-closed-discovery";
  }
  if (profile.name === "ping-sequence-counter-semantic-continuation-v1") {
    return "level-2-semantic-continuation";
  }
  return "level-1-semantic-restart";
}

function productSupportLevelName(level: ProductSupportLevel): string {
  switch (level) {
    case "level-0-fail-closed-discovery":
      return "Level 0 — Fail-closed discovery";
    case "level-1-semantic-restart":
      return "Level 1 — Semantic restart";
    case "level-2-semantic-continuation":
      return "Level 2 — Semantic continuation";
    case "level-3-runtime-aware-continuation":
      return "Level 3 — Runtime-aware continuation";
    case "level-4-kernel-resource-reconstruction":
      return "Level 4 — Kernel-resource reconstruction";
    case "level-5-cross-arch-process-continuation":
      return "Level 5 — Cross-arch process continuation";
  }
}

function defaultObservableStateDecisions(
  profile: ProductClaimProofProfileInput,
  level: ProductSupportLevel,
): ProductClaimObservableStateDecision[] {
  if (level === "level-1-semantic-restart") {
    return [
      {
        name: "process",
        decision: "recreated",
        rationale: "clean-service product support starts a target-native process and verifies it",
      },
      {
        name: "unsafe-kernel-state",
        decision: "refused",
        rationale: "state outside the clean-service contract refuses before success is reported",
      },
    ];
  }
  if (level === "level-2-semantic-continuation") {
    return [
      {
        name: "logical-state",
        decision: "logically-restored",
        rationale: "selected user-visible state is carried through an explicit descriptor",
      },
      {
        name: "kernel-private-state",
        decision: "refused",
        rationale: "kernel-exact state remains outside the Level 2 contract",
      },
    ];
  }
  return [
    {
      name: profile.unsafeStateFamily ?? profile.name,
      decision: "refused",
      rationale: "the product surface fails closed until this state has a modeled contract",
    },
  ];
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
    if (profile.name === "ping-sequence-counter-semantic-continuation-v1") {
      return "Implemented Level 2 semantic continuation for ping counters and sequence boundary with fail-closed queue/socket refusals.";
    }
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
