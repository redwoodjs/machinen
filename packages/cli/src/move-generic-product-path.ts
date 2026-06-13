import type { MoveDescriptor } from "@machinen/runtime";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type GenericState = NonNullable<MoveCapture["genericResourceGraphState"]>;
type GenericProductPath = NonNullable<NonNullable<GenericState["migration"]>["productPath"]>;

type PromotedGenericProductPath = {
  markerProofName: string;
  supportProofName: string;
  refusalProofNames: string[];
};

const promotedGenericProductPaths: PromotedGenericProductPath[] = [
  {
    markerProofName: "generic-stdio-pipe-product-marker",
    supportProofName: "generic-finite-pipe-buffer-replay",
    refusalProofNames: ["generic-pipe-stdio-refusals"],
  },
  {
    markerProofName: "unix-pathname-listener-live-generic-primary-marker",
    supportProofName: "generic-unix-pathname-listener",
    refusalProofNames: ["generic-unix-pathname-listener-refusals"],
  },
  {
    markerProofName: "reader-cat-live-generic-primary-marker",
    supportProofName: "reader-cat",
    refusalProofNames: [
      "generic-stale-file-identity-refusal",
      "generic-deleted-file-fd-refusal",
      "generic-writable-file-cursor-refusal",
    ],
  },
  {
    markerProofName: "grep-live-generic-primary-marker",
    supportProofName: "grep",
    refusalProofNames: [
      "generic-stale-file-identity-refusal",
      "generic-deleted-file-fd-refusal",
      "generic-writable-file-cursor-refusal",
      "generic-pipe-stdio-refusals",
    ],
  },
  {
    markerProofName: "busybox-nc-listener-live-generic-primary-marker",
    supportProofName: "busybox-nc-listener",
    refusalProofNames: [
      "unsafe-busybox-nc-refusal",
      "unsafe-nc-active-refusal",
      "generic-loader-preflight-refusals",
    ],
  },
  {
    markerProofName: "socat-file-responder-live-generic-primary-marker",
    supportProofName: "socat-file-responder",
    refusalProofNames: ["unsafe-socat-file-responder-refusal", "generic-loader-preflight-refusals"],
  },
];

export function genericProductPathIsPromoted(productPath: GenericProductPath | undefined): boolean {
  if (productPath?.kind !== "exact-live-capture") {
    return false;
  }
  if (productPath.observedGraph !== "exact-live-resource-graph") {
    return false;
  }
  return promotedGenericProductPaths.some(
    (promoted) =>
      productPath.markerProofName === promoted.markerProofName &&
      productPath.supportProofName === promoted.supportProofName &&
      sameList(productPath.refusalProofNames, promoted.refusalProofNames),
  );
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
