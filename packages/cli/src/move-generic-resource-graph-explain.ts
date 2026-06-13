import type { MoveDescriptor } from "@machinen/runtime";

import { genericResourceGraphIsProductPrimary } from "./move-generic-resource-graph.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type GenericState = NonNullable<MoveCapture["genericResourceGraphState"]>;

export type GenericResourceGraphMoveExplanation = {
  decision:
    | "missing-generic-state"
    | "generic-product"
    | "explicit-fallback"
    | "proof-only"
    | "deferred"
    | "blocked"
    | "fail-closed-refusal";
  productSupport: boolean;
  proofName?: string;
  userMessage: string;
  reasons: string[];
  nonClaims: string[];
};

const proofOnlyGenericRows = new Set([
  "generic-service-process-tree-prefork",
  "generic-same-arch-modeled-continuation",
  "generic-cross-arch-semantic-reconstruction",
]);

const deferredGenericRows = new Set([
  "generic-two-process-pipe-reexec",
  "generic-unix-pathname-client-pair",
  "generic-timerfd-relative-oneshot",
  "generic-file-lock-advisory",
  "generic-inotify-file-follow",
  "generic-mmap-file-backed-clean",
  "generic-epoll-timerfd-watch",
  "generic-service-redis-idle-parity",
]);

const blockedGenericRows = new Map([
  ["node-static-http-live-generic-primary-marker", "blocked by full source/target tree identity"],
  ["go-static-http-live-generic-primary-marker", "blocked by full source/target tree identity"],
  ["rust-static-http-live-generic-primary-marker", "blocked by full source/target tree identity"],
  ["busybox-httpd-live-generic-primary-marker", "blocked by full source/target tree identity"],
  ["nginx-live-generic-primary-marker", "blocked by service safety"],
  ["caddy-live-generic-primary-marker", "blocked by service safety"],
  ["ruby-live-generic-primary-marker", "blocked by service safety"],
  ["rsync-live-generic-primary-marker", "blocked by service safety"],
  ["redis-live-generic-primary-marker", "blocked by service/database safety"],
  ["tail-live-generic-primary-marker", "blocked by active follow/session state"],
]);

const genericProductNonClaims = [
  "no arbitrary process restore",
  "no broad daemon/database/service migration",
  "no active session migration",
  "no source-fd teleportation",
  "no source-ISA emulation",
  "no metadata-only success",
  "no runtime-profile shortcut",
];

export function explainGenericResourceGraphMovePlan(
  state: GenericState | undefined,
): GenericResourceGraphMoveExplanation {
  if (!state) {
    return {
      decision: "missing-generic-state",
      productSupport: false,
      userMessage: "Generic resource graph evidence is missing, so machinen move cannot use it.",
      reasons: ["generic resource graph state was not captured"],
      nonClaims: genericProductNonClaims,
    };
  }

  const migration = state.migration;
  const proofName = migration?.productPath?.markerProofName ?? migration?.genericProofName;

  if (state.refusalClasses.length > 0) {
    const firstRefusal = state.refusalClasses[0];
    return {
      decision: "fail-closed-refusal",
      productSupport: false,
      proofName,
      userMessage: `Generic product move is refused because ${firstRefusal.resourceClass} is not inside the exact supported shape.`,
      reasons: state.refusalClasses.map((refusal) => `${refusal.resourceClass}: ${refusal.reason}`),
      nonClaims: genericProductNonClaims,
    };
  }

  if (genericResourceGraphIsProductPrimary(state)) {
    const productPath = state.migration?.productPath;
    return {
      decision: "generic-product",
      productSupport: true,
      proofName: productPath?.markerProofName,
      userMessage: `Generic product move is selected for exact live-capture proof ${productPath?.markerProofName}.`,
      reasons: [
        "migration mode is generic-primary",
        "productPath.kind is exact-live-capture",
        `support proof is ${productPath?.supportProofName}`,
        `refusal proofs are ${productPath?.refusalProofNames.join(", ")}`,
        "refusalClasses is empty",
      ],
      nonClaims: genericProductNonClaims,
    };
  }

  if (proofName && proofOnlyGenericRows.has(proofName)) {
    return {
      decision: "proof-only",
      productSupport: false,
      proofName,
      userMessage: `Generic row ${proofName} is proof-only and is not product support for machinen move.`,
      reasons: [
        "row is classified as proof-only",
        "productPath exact-live-capture metadata is absent",
      ],
      nonClaims: genericProductNonClaims,
    };
  }

  if (proofName && deferredGenericRows.has(proofName)) {
    return {
      decision: "deferred",
      productSupport: false,
      proofName,
      userMessage: `Generic row ${proofName} is deferred from product routing until a narrower product contract is proven.`,
      reasons: [
        "row is classified as deferred",
        "productPath exact-live-capture metadata is not enough for this phase",
      ],
      nonClaims: genericProductNonClaims,
    };
  }

  const blocker = proofName ? blockedGenericRows.get(proofName) : undefined;
  if (proofName && blocker) {
    return {
      decision: "blocked",
      productSupport: false,
      proofName,
      userMessage: `Generic row ${proofName} is blocked from product routing because it is ${blocker}.`,
      reasons: [
        blocker,
        "row needs a later product contract with equivalent support and refusal evidence",
      ],
      nonClaims: genericProductNonClaims,
    };
  }

  return {
    decision: "explicit-fallback",
    productSupport: false,
    proofName,
    userMessage:
      "machinen move keeps the explicit envelope fallback because this generic row is not an exact product path.",
    reasons: [
      migration?.fallbackPolicy ?? "no generic-primary product path was recorded",
      "generic product selection requires exact-live-capture productPath metadata and no refusal classes",
    ],
    nonClaims: genericProductNonClaims,
  };
}
