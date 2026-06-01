import { nodeLevel5ProductSupport80ClaimRegistry } from "./node-level5-product-support-80-hardening.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_85_KIND = "machinen.node-level5-product-support-85";
export const NODE_LEVEL5_PRODUCT_SUPPORT_85_VERSION = 1;

export type NodeLevel5ProductSupport85ClaimRegistry = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_85_KIND;
  status: "node-product-support-85-claimed";
  declaredSubsetExperimentalProductSupportClaimed: 100;
  nodeProductSupportTiers: readonly [20, 50, 65, 80, 85];
  nodeProductSupportClaimed: 85;
  broadNodeProductSupportClaimed: 25;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  previousNodeProductSupportClaimed: 80;
  previousBroadNodeProductSupportClaimed: 20;
  genericVmDetectedEvidenceRequired: true;
  retainedEvidenceRequired: true;
  rowArtifactEvidenceRequired: true;
  refusalArtifactEvidenceRequired: true;
  realVmCrossArchEvidenceRequired: true;
  artifactRetentionDays: 30;
  flakeBudgetPercent: 0;
  supportedAppRows: 68;
  refusedAppRows: 42;
  notProvenAppRows: 4;
  unsupportedDetectorCount: number;
};

export const nodeLevel5ProductSupport85ClaimRegistry: NodeLevel5ProductSupport85ClaimRegistry = {
  kind: NODE_LEVEL5_PRODUCT_SUPPORT_85_KIND,
  status: "node-product-support-85-claimed",
  declaredSubsetExperimentalProductSupportClaimed: 100,
  nodeProductSupportTiers: [20, 50, 65, 80, 85],
  nodeProductSupportClaimed: 85,
  broadNodeProductSupportClaimed: 25,
  arbitraryProcessCrossArchRestoreClaimed: 0,
  previousNodeProductSupportClaimed: 80,
  previousBroadNodeProductSupportClaimed: 20,
  genericVmDetectedEvidenceRequired: true,
  retainedEvidenceRequired: true,
  rowArtifactEvidenceRequired: true,
  refusalArtifactEvidenceRequired: true,
  realVmCrossArchEvidenceRequired: true,
  artifactRetentionDays: 30,
  flakeBudgetPercent: 0,
  supportedAppRows: 68,
  refusedAppRows: 42,
  notProvenAppRows: 4,
  unsupportedDetectorCount: nodeLevel5ProductSupport80ClaimRegistry.unsupportedDetectorCount,
};
