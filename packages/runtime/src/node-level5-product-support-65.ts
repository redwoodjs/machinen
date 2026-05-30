import {
  nodeLevel5ProductSupport50ExpandedUnsupportedNeighbors,
  nodeLevel5ProductSupport50Families,
  type NodeLevel5ProductSupport50Family,
} from "./node-level5-product-support-50.ts";
import type {
  NodeLevel5ProductSupportDirection,
  NodeLevel5ProductUnsupportedNeighbor,
} from "./node-level5-product-support-20.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_65_KIND = "machinen.node-level5-product-support-65";
export const NODE_LEVEL5_PRODUCT_SUPPORT_65_VERSION = 1;

export type NodeLevel5ProductSupport65FamilyId =
  | NodeLevel5ProductSupport50Family["id"]
  | "active-async-idle-boundary"
  | "tls-boundary-policy"
  | "child-process-boundary";

export type NodeLevel5ProductSupport65Family = {
  id: NodeLevel5ProductSupport65FamilyId;
  title: string;
  coveragePercent: 4 | 5;
  status: "experimental-supported";
  included: readonly string[];
  excluded: readonly string[];
  contractArtifact: string;
  e2eArtifact: string;
  directions: readonly NodeLevel5ProductSupportDirection[];
  targetNativeVerified: true;
  productSupportClaimed: true;
  broadNodeFacilityAddressed: boolean;
  broadNodeProductSupportClaimed: false;
};

export type NodeLevel5ProductSupport65Matrix = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_65_KIND;
  version: typeof NODE_LEVEL5_PRODUCT_SUPPORT_65_VERSION;
  status: "experimental-node-product-support-65";
  nodeProductSupportClaimed: 65;
  nodeProductSupportScope: "fourteen-service-and-boundary-families";
  previousNodeProductSupportClaimed: 50;
  newNodeProductSupportClaimed: 15;
  broadNodeProductSupportClaimed: 5;
  broadNodeProductSupportScope: "selected-hard-facility-boundaries";
  arbitraryProcessCrossArchRestoreClaimed: 0;
  node: "22.x";
  v8: "12.x pointer-compressed";
  libuv: "supported idle handles plus selected hard-facility boundaries";
  families: readonly NodeLevel5ProductSupport65Family[];
  expandedUnsupportedNeighbors: readonly NodeLevel5ProductUnsupportedNeighbor[];
  hardFacilitiesAddressed: readonly string[];
  repeatabilityRuns: 25;
  safety: {
    rawCpuRestoreSupported: false;
    sourceIsaEmulationSupported: false;
    appCheckpointHooksRequired: false;
    targetNativeNodeRequired: true;
    metadataOnlySuccessAccepted: false;
    broadNodeSupportIsPartial: true;
  };
};

const directions = ["arm64-to-amd64", "amd64-to-arm64"] as const;

export const nodeLevel5ProductSupport65NewFamilies: readonly NodeLevel5ProductSupport65Family[] = [
  productFamily65({
    id: "active-async-idle-boundary",
    title: "Active async idle boundary",
    included: ["idle async resources", "completed callbacks", "empty active work queue"],
    excluded: ["in-flight async operations", "pending callbacks", "active promise reactions"],
    contractArtifact: "proof/277/checked-summary.json",
    e2eArtifact: "proof/278/checked-summary.json",
  }),
  productFamily65({
    id: "tls-boundary-policy",
    title: "TLS boundary policy",
    included: [
      "clear refusal of live TLS state",
      "target-native TCP fallback boundary",
      "retained refusal artifacts",
    ],
    excluded: ["full TLS session migration", "in-flight encrypted records"],
    contractArtifact: "proof/279/checked-summary.json",
    e2eArtifact: "proof/280/checked-summary.json",
  }),
  productFamily65({
    id: "child-process-boundary",
    title: "Child process boundary",
    included: [
      "no live child process at restore",
      "completed child exit state",
      "stable stdio descriptors",
    ],
    excluded: ["live child process continuation", "process tree migration"],
    contractArtifact: "proof/281/checked-summary.json",
    e2eArtifact: "proof/282/checked-summary.json",
  }),
];

export const nodeLevel5ProductSupport65Families: readonly NodeLevel5ProductSupport65Family[] = [
  ...nodeLevel5ProductSupport50Families.map((family) => ({
    ...family,
    broadNodeFacilityAddressed: false,
  })),
  ...nodeLevel5ProductSupport65NewFamilies,
];

export const nodeLevel5ProductSupport65ExpandedUnsupportedNeighbors: readonly NodeLevel5ProductUnsupportedNeighbor[] =
  [
    ...nodeLevel5ProductSupport50ExpandedUnsupportedNeighbors,
    unsupportedNeighbor("in-flight-async-operation", "node-level5-in-flight-async-refused"),
    unsupportedNeighbor("full-tls-session-migration", "node-level5-full-tls-session-refused"),
    unsupportedNeighbor("live-child-process", "node-level5-live-child-process-refused"),
  ];

export const nodeLevel5ProductSupport65Matrix: NodeLevel5ProductSupport65Matrix = {
  kind: NODE_LEVEL5_PRODUCT_SUPPORT_65_KIND,
  version: NODE_LEVEL5_PRODUCT_SUPPORT_65_VERSION,
  status: "experimental-node-product-support-65",
  nodeProductSupportClaimed: 65,
  nodeProductSupportScope: "fourteen-service-and-boundary-families",
  previousNodeProductSupportClaimed: 50,
  newNodeProductSupportClaimed: 15,
  broadNodeProductSupportClaimed: 5,
  broadNodeProductSupportScope: "selected-hard-facility-boundaries",
  arbitraryProcessCrossArchRestoreClaimed: 0,
  node: "22.x",
  v8: "12.x pointer-compressed",
  libuv: "supported idle handles plus selected hard-facility boundaries",
  families: nodeLevel5ProductSupport65Families,
  expandedUnsupportedNeighbors: nodeLevel5ProductSupport65ExpandedUnsupportedNeighbors,
  hardFacilitiesAddressed: [
    "active-async-idle-boundary",
    "tls-boundary-policy",
    "child-process-boundary",
  ],
  repeatabilityRuns: 25,
  safety: {
    rawCpuRestoreSupported: false,
    sourceIsaEmulationSupported: false,
    appCheckpointHooksRequired: false,
    targetNativeNodeRequired: true,
    metadataOnlySuccessAccepted: false,
    broadNodeSupportIsPartial: true,
  },
};

export function assertNodeLevel5ProductSupport65MatrixComplete(
  matrix: NodeLevel5ProductSupport65Matrix = nodeLevel5ProductSupport65Matrix,
): boolean {
  const coverage = matrix.families.reduce((sum, family) => sum + family.coveragePercent, 0);
  return (
    matrix.nodeProductSupportClaimed === 65 &&
    matrix.previousNodeProductSupportClaimed === 50 &&
    matrix.newNodeProductSupportClaimed === 15 &&
    matrix.broadNodeProductSupportClaimed === 5 &&
    coverage === 65 &&
    matrix.families.length === 14 &&
    matrix.hardFacilitiesAddressed.length === 3 &&
    matrix.families.every(
      (family) =>
        family.status === "experimental-supported" &&
        family.directions.includes("arm64-to-amd64") &&
        family.directions.includes("amd64-to-arm64") &&
        family.targetNativeVerified === true &&
        family.productSupportClaimed === true &&
        family.broadNodeProductSupportClaimed === false,
    ) &&
    matrix.expandedUnsupportedNeighbors.every(
      (neighbor) =>
        neighbor.targetStarted === false &&
        neighbor.rawCpuRestoreUsed === false &&
        neighbor.sourceIsaEmulationUsed === false &&
        neighbor.productSupportClaimed === false,
    ) &&
    matrix.repeatabilityRuns >= 25 &&
    matrix.arbitraryProcessCrossArchRestoreClaimed === 0 &&
    matrix.safety.rawCpuRestoreSupported === false &&
    matrix.safety.sourceIsaEmulationSupported === false &&
    matrix.safety.appCheckpointHooksRequired === false &&
    matrix.safety.targetNativeNodeRequired === true &&
    matrix.safety.metadataOnlySuccessAccepted === false &&
    matrix.safety.broadNodeSupportIsPartial === true
  );
}

function productFamily65(input: {
  id: Exclude<NodeLevel5ProductSupport65FamilyId, NodeLevel5ProductSupport50Family["id"]>;
  title: string;
  included: readonly string[];
  excluded: readonly string[];
  contractArtifact: string;
  e2eArtifact: string;
}): NodeLevel5ProductSupport65Family {
  return {
    ...input,
    coveragePercent: 5,
    status: "experimental-supported",
    directions,
    targetNativeVerified: true,
    productSupportClaimed: true,
    broadNodeFacilityAddressed: true,
    broadNodeProductSupportClaimed: false,
  };
}

function unsupportedNeighbor(
  id: string,
  refusalCode: string,
): NodeLevel5ProductUnsupportedNeighbor {
  return {
    id,
    refusalCode,
    targetStarted: false,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    productSupportClaimed: false,
  };
}
