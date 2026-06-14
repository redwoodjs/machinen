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

export const staticHttpTreeIdentityProductPathMarkers = new Set([
  "node-static-http-live-generic-primary-marker",
  "go-static-http-live-generic-primary-marker",
  "rust-static-http-live-generic-primary-marker",
  "busybox-httpd-live-generic-primary-marker",
]);

/**
 * Product move continuation allowlist.
 *
 * This intentionally excludes the former generic resource graph product rows
 * because they are reexec or resource-reconstruction behavior, not modeled
 * live-state continuation. They remain available as proof/refusal evidence and
 * may be relabeled by docs, but they are not product move continuation routes.
 */
const promotedGenericProductPaths: PromotedGenericProductPath[] = [];

export function genericProductPathIsPromoted(productPath: GenericProductPath | undefined): boolean {
  return productPathMatches(productPath, promotedGenericProductPaths);
}

export function staticHttpTreeIdentityProductPathIsProofSelected(
  _productPath: GenericProductPath | undefined,
): boolean {
  return false;
}

function productPathMatches(
  productPath: GenericProductPath | undefined,
  paths: PromotedGenericProductPath[],
): boolean {
  if (productPath?.kind !== "exact-live-capture") {
    return false;
  }
  if (productPath.observedGraph !== "exact-live-resource-graph") {
    return false;
  }
  return paths.some(
    (promoted) =>
      productPath.markerProofName === promoted.markerProofName &&
      productPath.supportProofName === promoted.supportProofName &&
      sameList(productPath.refusalProofNames, promoted.refusalProofNames),
  );
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
