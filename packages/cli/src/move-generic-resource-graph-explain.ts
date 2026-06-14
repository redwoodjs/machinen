import type { MoveDescriptor } from "@machinen/runtime";

import { genericResourceGraphIsProductPrimary } from "./move-generic-resource-graph.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type GenericState = NonNullable<MoveCapture["genericResourceGraphState"]>;

type GenericResourceGraphMoveExplanation = {
  decision:
    | "missing-generic-state"
    | "generic-product"
    | "explicit-fallback"
    | "proof-only"
    | "resource-reconstruction"
    | "reexec"
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

const resourceReconstructionRows = new Set([
  "generic-stdio-pipe-product-marker",
  "reader-cat-live-generic-primary-marker",
  "grep-live-generic-primary-marker",
]);

const reexecRows = new Set([
  "unix-pathname-listener-live-generic-primary-marker",
  "busybox-nc-listener-live-generic-primary-marker",
  "socat-file-responder-live-generic-primary-marker",
  "node-static-http-live-generic-primary-marker",
  "go-static-http-live-generic-primary-marker",
  "rust-static-http-live-generic-primary-marker",
  "busybox-httpd-live-generic-primary-marker",
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

  const knownNonProductRow = explainKnownNonProductRow(proofName);
  if (knownNonProductRow) {
    return knownNonProductRow;
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

function explainKnownNonProductRow(
  proofName: string | undefined,
): GenericResourceGraphMoveExplanation | undefined {
  if (!proofName) {
    return undefined;
  }
  if (proofOnlyGenericRows.has(proofName)) {
    return nonProductExplanation(
      "proof-only",
      proofName,
      `Generic row ${proofName} is proof-only and is not product support for machinen move.`,
      ["row is classified as proof-only", "productPath exact-live-capture metadata is absent"],
    );
  }
  if (resourceReconstructionRows.has(proofName)) {
    return nonProductExplanation(
      "resource-reconstruction",
      proofName,
      `Generic row ${proofName} is retained resource-reconstruction evidence, not product move continuation.`,
      [
        "row is classified as resource-reconstruction",
        "captured files, cursors, bytes, or semantic descriptors are rebuilt target-side",
        "productPath exact-live-capture metadata is not sufficient for product move continuation",
      ],
    );
  }
  if (reexecRows.has(proofName)) {
    return nonProductExplanation(
      "reexec",
      proofName,
      `Generic row ${proofName} is retained target-native reexec evidence, not product move continuation.`,
      [
        "row is classified as reexec",
        "target process, listener, or static HTTP server is restarted target-side",
        "productPath exact-live-capture metadata is not sufficient for product move continuation",
      ],
    );
  }
  if (deferredGenericRows.has(proofName)) {
    return nonProductExplanation(
      "deferred",
      proofName,
      `Generic row ${proofName} is deferred from product routing until a narrower product contract is proven.`,
      [
        "row is classified as deferred",
        "productPath exact-live-capture metadata is not enough for this phase",
      ],
    );
  }
  const blocker = blockedGenericRows.get(proofName);
  return blocker
    ? nonProductExplanation(
        "blocked",
        proofName,
        `Generic row ${proofName} is blocked from product routing because it is ${blocker}.`,
        [
          blocker,
          "row needs a later product contract with equivalent support and refusal evidence",
        ],
      )
    : undefined;
}

function nonProductExplanation(
  decision: Exclude<
    GenericResourceGraphMoveExplanation["decision"],
    "missing-generic-state" | "generic-product" | "explicit-fallback" | "fail-closed-refusal"
  >,
  proofName: string,
  userMessage: string,
  reasons: string[],
): GenericResourceGraphMoveExplanation {
  return {
    decision,
    productSupport: false,
    proofName,
    userMessage,
    reasons,
    nonClaims: genericProductNonClaims,
  };
}
