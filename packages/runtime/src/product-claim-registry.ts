export const PRODUCT_CLAIM_REGISTRY_FORMAT_VERSION = 1 as const;

export const productSupportLevels = [
  "level-0-fail-closed-discovery",
  "level-5-cross-arch-process-continuation",
] as const;
export type ProductSupportLevel = (typeof productSupportLevels)[number];

export const productClaimStatuses = [
  "implemented-product-support",
  "deprecated-legacy-support",
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
export const PRODUCT_CLAIM_DEPRECATED_LEGACY_REFUSAL_CODE = "deprecated-cross-isa-level" as const;

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
  deprecatedLegacySupport: number;
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

const IMPLEMENTED_PRODUCT_PROFILES = new Set<string>();

const DEPRECATED_LEGACY_PRODUCT_PROFILES = new Set([
  "node-app-http-server-recreate",
  "python-cross-arch-runtime-policy",
  "go-cross-arch-runtime-policy",
  "ping-level4-socket-reconstruction-v1",
  "eventfd-counter-v1-nonsemaphore-no-waiters",
  "pipe-pair-v1-empty-no-waiters",
  "timerfd-relative-oneshot-v1-monotonic",
  "tcp-listener-v1-loopback-empty-accept-queue",
]);

const BUILTIN_PRODUCT_PROFILES: ProductClaimProofProfileInput[] = [
  {
    name: "node-v8-libuv-single-thread-http-v1",
    description:
      "Goal 022 selected-state reconstruction harness proof: restore only the quickstart Node HTTP counter fixture across architectures. This is not Level 5 product support because the input is an app-specific selected-state descriptor, not reconstructed source process/runtime/native state.",
    sourceFixture: "machinen-snapshot-restore:node-http-counter-selected-state-v1",
    expectedResult: "success",
    supportStatus: "selected-state-reconstruction-harness-proof",
    unsafeStateFamily: "node-http-counter-selected-state",
    capabilities: [
      "goal022:machinen-snapshot",
      "goal022:machinen-restore",
      "goal022:selected-state-reconstruction-harness",
      "runtime:node",
      "node:http-single-thread",
      "node:selected-state-counter",
      "http:root-json-counter",
      "network:tcp-listener-empty-accept-queue",
      "target:target-native-node",
      "gate:no-source-isa-emulation",
      "gate:no-sidecar-output",
      "gate:no-metadata-only-success",
    ],
    refusesCapabilities: [
      "node:arbitrary-v8-heap-native-stack",
      "node:native-addon",
      "node:worker-thread",
      "node:inspector-debug",
      "node:active-request",
      "node:active-tcp-stream",
      "node:active-syscall",
      "node:unsupported-v8-libuv-state",
      "node:missing-target-native-node",
    ],
    observableStateDecisions: [
      {
        name: "counter-value",
        decision: "preserved",
        rationale:
          "snapshot records a bounded app-specific selected-state counter descriptor and restore seeds target-native Node so the first target request returns the next count; this is harness evidence, not Level 5 product support",
      },
      {
        name: "node-process",
        decision: "recreated",
        rationale: "restore starts a target-native Node process for the harness proof",
      },
      {
        name: "tcp-listener",
        decision: "recreated",
        rationale: "restore recreates an empty HTTP listener on the target",
      },
      {
        name: "broad-node-runtime-state",
        decision: "refused",
        rationale:
          "arbitrary V8 heap/native stack, native addons, workers, inspector/debug state, active requests, active TCP streams, active syscalls, and unsupported V8/libuv state remain outside the product boundary",
      },
    ],
    checkedSummary:
      "docs/snapshot/checked-summaries/level4-graduation/goal-022-real-cross-arch-quickstart-fixture.json",
  },
  {
    name: "tcp-listener-v1-loopback-empty-accept-queue",
    description:
      "Goal 018 portable restore adapter product route: reconstruct a loopback TCP listener when bind address, port, backlog, and reuseaddr are explicit, the accept queue is empty, and there are no active TCP connections or socket syscalls.",
    sourceFixture: "portable-restore-adapter:tcp-listener-v1-loopback-empty-accept-queue",
    expectedResult: "success",
    supportStatus: "implemented-product-support",
    unsafeStateFamily: "tcp-listener",
    capabilities: [
      "goal018:portable-restore-adapter",
      "goal018:level-4-kernel-resource-reconstruction",
      "fd:tcp-listener",
      "tcp:loopback-bind",
      "tcp:static-port",
      "tcp:explicit-backlog",
      "tcp:empty-accept-queue",
      "tcp:no-active-connections",
      "tcp:reuseaddr",
      "goal018:target-native-verifier",
    ],
    observableStateDecisions: [
      {
        name: "listener-socket",
        decision: "recreated",
        rationale: "the target creates a fresh Linux TCP socket and calls bind/listen",
      },
      {
        name: "bind-address-port",
        decision: "preserved",
        rationale: "the descriptor carries the loopback address and static port",
      },
      {
        name: "accept-queue",
        decision: "refused",
        rationale: "non-empty or unknown accept queues are refused for this listener-only boundary",
      },
      {
        name: "active-connections",
        decision: "refused",
        rationale: "active TCP streams are not part of listener-only reconstruction",
      },
    ],
    checkedSummary: "docs/snapshot/checked-summaries/level4-graduation/goal-018.json",
    refusalSupportContract: {
      currentRefusalCode: "tcp-listener-active-connections-unsupported",
      graduationRequires: [],
    },
  },
  {
    name: "timerfd-relative-oneshot-v1-monotonic",
    description:
      "Goal 017 portable restore adapter product route: reconstruct a CLOCK_MONOTONIC relative one-shot timerfd when remaining time is bounded, there are no unread expirations, no periodic interval, flags are limited to close-on-exec, and no timerfd read syscall is active.",
    sourceFixture: "portable-restore-adapter:timerfd-relative-oneshot-v1-monotonic",
    expectedResult: "success",
    supportStatus: "implemented-product-support",
    unsafeStateFamily: "timerfd-relative-oneshot",
    capabilities: [
      "goal017:portable-restore-adapter",
      "goal017:level-4-kernel-resource-reconstruction",
      "fd:timerfd",
      "timerfd:clock-monotonic",
      "timerfd:relative-oneshot",
      "timerfd:bounded-remaining-time",
      "timerfd:no-unread-expirations",
      "timerfd:close-on-exec",
      "goal017:target-native-verifier",
    ],
    observableStateDecisions: [
      {
        name: "timerfd-object",
        decision: "recreated",
        rationale: "the target creates a fresh Linux timerfd instead of replaying source text",
      },
      {
        name: "remaining-time",
        decision: "preserved",
        rationale:
          "the descriptor carries a bounded relative remaining time and the target verifier observes it",
      },
      {
        name: "unread-expirations",
        decision: "refused",
        rationale: "unread expirations must be zero for this first product boundary",
      },
      {
        name: "periodic-interval",
        decision: "refused",
        rationale: "periodic timers are refused until interval semantics are modeled",
      },
    ],
    checkedSummary: "docs/snapshot/checked-summaries/level4-graduation/goal-017.json",
    refusalSupportContract: {
      currentRefusalCode: "timerfd-unread-expirations-unsupported",
      graduationRequires: [],
    },
  },
  {
    name: "pipe-pair-v1-empty-no-waiters",
    description:
      "Goal 016 portable restore adapter product route: reconstruct an empty target-native pipe pair when there is exactly one read end and one write end, peer lifetime is known open, waiters are known empty, readiness is known not-readable, flags are limited to close-on-exec, and no pipe syscall is active.",
    sourceFixture: "portable-restore-adapter:pipe-pair-v1-empty-no-waiters",
    expectedResult: "success",
    supportStatus: "implemented-product-support",
    unsafeStateFamily: "pipe-pair",
    capabilities: [
      "goal016:portable-restore-adapter",
      "goal016:level-4-kernel-resource-reconstruction",
      "fd:pipe-read-end",
      "fd:pipe-write-end",
      "pipe:empty-buffer",
      "pipe:peer-open",
      "pipe:no-waiters",
      "pipe:not-readable",
      "pipe:close-on-exec",
      "goal016:target-native-verifier",
    ],
    observableStateDecisions: [
      {
        name: "pipe-pair",
        decision: "recreated",
        rationale: "the target creates a fresh Linux pipe pair instead of replaying source text",
      },
      {
        name: "pipe-buffer",
        decision: "preserved",
        rationale: "the supported product boundary preserves the observed empty-buffer state",
      },
      {
        name: "pipe-waiters",
        decision: "refused",
        rationale: "waiters must be known empty for this first product boundary",
      },
      {
        name: "pipe-buffered-bytes",
        decision: "refused",
        rationale:
          "buffered bytes are refused until a later adapter models byte replay and ordering",
      },
    ],
    checkedSummary: "docs/snapshot/checked-summaries/level4-graduation/goal-016.json",
    refusalSupportContract: {
      currentRefusalCode: "pipe-waiters-unsupported",
      graduationRequires: [],
    },
  },
  {
    name: "eventfd-counter-v1-nonsemaphore-no-waiters",
    description:
      "Goal 015 portable restore adapter product route: reconstruct a bounded nonzero eventfd counter target-natively when semaphore mode is off, waiters are known empty, aliases are absent, flags are limited to close-on-exec, and no eventfd syscall is active.",
    sourceFixture: "portable-restore-adapter:eventfd-counter-v1-nonsemaphore-no-waiters",
    expectedResult: "success",
    supportStatus: "implemented-product-support",
    unsafeStateFamily: "eventfd-counter",
    capabilities: [
      "goal015:portable-restore-adapter",
      "goal015:level-4-kernel-resource-reconstruction",
      "fd:eventfd",
      "eventfd:bounded-nonzero-counter",
      "eventfd:non-semaphore",
      "eventfd:no-waiters",
      "eventfd:no-aliases",
      "eventfd:close-on-exec",
      "goal015:target-native-verifier",
    ],
    observableStateDecisions: [
      {
        name: "eventfd-counter",
        decision: "preserved",
        rationale:
          "the product descriptor carries the bounded counter and verifies the target-native eventfd reports it",
      },
      {
        name: "eventfd-object",
        decision: "recreated",
        rationale: "the target creates a fresh Linux eventfd instead of replaying source text",
      },
      {
        name: "eventfd-waiters",
        decision: "refused",
        rationale: "waiters must be known empty for this first product boundary",
      },
      {
        name: "eventfd-aliases",
        decision: "refused",
        rationale: "aliases are refused until a later adapter models duplicate fd semantics",
      },
    ],
    checkedSummary: "docs/snapshot/checked-summaries/level4-graduation/goal-015.json",
    refusalSupportContract: {
      currentRefusalCode: "eventfd-waiters-unsupported",
      graduationRequires: [],
    },
  },
  {
    name: "ping-level4-socket-reconstruction-v1",
    description:
      "Goal 011 portable machine Level 4 product route: reconstruct a target-native ping datagram or raw ICMP socket from machinen snapshot/restore only when the capture boundary has an empty receive queue, no in-flight packets, no active recvmsg, unambiguous loopback routing, and a credential/capability mapping.",
    sourceFixture: "portable-machine-transport:ping-level4-socket-reconstruction-v1",
    expectedResult: "success",
    supportStatus: "implemented-product-support",
    unsafeStateFamily: "network-ping-socket",
    capabilities: [
      "goal011:portable-machine-transport",
      "goal011:level-4-kernel-resource-reconstruction",
      "network:ping-socket-loopback",
      "network:raw-icmp-loopback",
      "fd:ping-socket",
      "fd:raw-icmp-socket",
      "packet:empty-receive-queue",
      "packet:no-inflight-icmp",
      "syscall:no-active-recvmsg",
      "route:loopback",
      "network-namespace:target-loopback",
      "credential:ping-group-range",
      "capability:cap-net-raw",
      "goal011:target-native-verifier",
    ],
    observableStateDecisions: [
      {
        name: "socket-descriptor",
        decision: "recreated",
        rationale:
          "the product descriptor records the accepted socket kind and recreates it target-natively",
      },
      {
        name: "icmp-echo-identity",
        decision: "preserved",
        rationale:
          "the descriptor carries the echo identifier and sequence accepted by the verifier",
      },
      {
        name: "receive-queue",
        decision: "drained",
        rationale: "the supported boundary requires an empty receive queue",
      },
      {
        name: "in-flight-packets",
        decision: "refused",
        rationale: "captures with in-flight packets are stable product refusals, not support",
      },
      {
        name: "active-recvmsg",
        decision: "refused",
        rationale: "captures blocked in recvmsg are outside the Level 4 product boundary",
      },
    ],
    checkedSummary: "docs/snapshot/checked-summaries/level4-graduation/goal-011.json",
    refusalSupportContract: {
      currentRefusalCode: "ping-socket-active-recvmsg-unsupported",
      graduationRequires: [],
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
  const deprecatedLegacy = DEPRECATED_LEGACY_PRODUCT_PROFILES.has(profile.name);
  const expectedResult =
    profile.expectedResult === "success" || profile.expectedResult === "refusal"
      ? profile.expectedResult
      : "unknown";
  const refusalCode =
    profile.expectedRefusalCode ?? profile.refusalSupportContract?.currentRefusalCode;
  const productStatus = implemented
    ? "implemented-product-support"
    : deprecatedLegacy
      ? "deprecated-legacy-support"
      : expectedResult === "refusal"
        ? "stable-product-refusal"
        : "proof-only-fixture";
  const productRefusalCode = implemented
    ? undefined
    : deprecatedLegacy
      ? PRODUCT_CLAIM_DEPRECATED_LEGACY_REFUSAL_CODE
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
    proofStatus: deprecatedLegacy
      ? "deprecated-legacy-support"
      : (profile.supportStatus ?? "unknown"),
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
      : deprecatedLegacy
        ? ["replace-legacy-level-with-move-pid-graph-translator"]
        : (profile.refusalSupportContract?.graduationRequires ??
          defaultGraduationRequirements(profile)),
    observableStateDecisions: deprecatedLegacy
      ? deprecatedLegacyObservableStateDecisions(profile)
      : (profile.observableStateDecisions ??
        defaultObservableStateDecisions(profile, supportLevel)),
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
    deprecatedLegacySupport: byStatus["deprecated-legacy-support"],
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
  if (status !== "implemented-product-support") {
    return "level-0-fail-closed-discovery";
  }
  return profile.productSupportLevel ?? "level-5-cross-arch-process-continuation";
}

function productSupportLevelName(level: ProductSupportLevel): string {
  switch (level) {
    case "level-0-fail-closed-discovery":
      return "Level 0 — Fail-closed discovery";
    case "level-5-cross-arch-process-continuation":
      return "Level 5 — Cross-arch process continuation";
  }
}

function deprecatedLegacyObservableStateDecisions(
  profile: ProductClaimProofProfileInput,
): ProductClaimObservableStateDecision[] {
  return [
    {
      name: profile.unsafeStateFamily ?? profile.name,
      decision: "refused",
      rationale:
        "legacy Level 1 through Level 4 support is deprecated and no longer reported as a product migration",
    },
    {
      name: "replacement-path",
      decision: "refused",
      rationale:
        "support must be rebuilt through a move-owned PID dependency graph translator before it can graduate",
    },
  ];
}

function defaultObservableStateDecisions(
  profile: ProductClaimProofProfileInput,
  _level: ProductSupportLevel,
): ProductClaimObservableStateDecision[] {
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
    return "Implemented product support with descriptor integrity checks and target-native verification.";
  }
  if (status === "deprecated-legacy-support") {
    return `Deprecated legacy cross-ISA level; product restore is refused with ${productRefusalCode} and must be replaced by a move-owned PID graph translator before support can be reintroduced.`;
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
