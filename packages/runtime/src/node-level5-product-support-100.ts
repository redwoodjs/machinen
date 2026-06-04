import { nodeLevel5ProductSupport90ClaimRegistry } from "./node-level5-product-support-90.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_100_KIND = "machinen.node-level5-product-support-100";
export const NODE_LEVEL5_PRODUCT_SUPPORT_100_VERSION = 1;

export type NodeLevel5ProductSupport100ClaimRegistry = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_100_KIND;
  status: "node-product-support-100-claimed";
  declaredSubsetExperimentalProductSupportClaimed: 0;
  nodeProductSupportTiers: readonly [20, 50, 65, 80, 85, 90, 95, 97, 98, 99, 100];
  nodeProductSupportClaimed: 100;
  broadNodeProductSupportClaimed: 100;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  previousNodeProductSupportClaimed: 90;
  previousBroadNodeProductSupportClaimed: 30;
  nodeServiceClaimLadderRequired: true;
  finalNodeServiceGaGateRequired: true;
  runtimeFrameworkCombinedGateRequired: true;
  runtimeStateTranslationGateRequired: true;
  crossCorpusConsistencyGateRequired: true;
  retainedEvidenceRequired: true;
  refusalArtifactEvidenceRequired: true;
  realVmCrossArchEvidenceRequired: true;
  artifactRetentionDays: 30;
  flakeBudgetPercent: 0;
  arbitraryNodeClaimed: false;
  arbitraryProcessClaimed: false;
  unsupportedDetectorCount: number;
};

export const nodeLevel5ProductSupport100ClaimRegistry: NodeLevel5ProductSupport100ClaimRegistry = {
  kind: NODE_LEVEL5_PRODUCT_SUPPORT_100_KIND,
  status: "node-product-support-100-claimed",
  declaredSubsetExperimentalProductSupportClaimed: 0,
  nodeProductSupportTiers: [20, 50, 65, 80, 85, 90, 95, 97, 98, 99, 100],
  nodeProductSupportClaimed: 100,
  broadNodeProductSupportClaimed: 100,
  arbitraryProcessCrossArchRestoreClaimed: 0,
  previousNodeProductSupportClaimed: 90,
  previousBroadNodeProductSupportClaimed: 30,
  nodeServiceClaimLadderRequired: true,
  finalNodeServiceGaGateRequired: true,
  runtimeFrameworkCombinedGateRequired: true,
  runtimeStateTranslationGateRequired: true,
  crossCorpusConsistencyGateRequired: true,
  retainedEvidenceRequired: true,
  refusalArtifactEvidenceRequired: true,
  realVmCrossArchEvidenceRequired: true,
  artifactRetentionDays: 30,
  flakeBudgetPercent: 0,
  arbitraryNodeClaimed: false,
  arbitraryProcessClaimed: false,
  unsupportedDetectorCount: nodeLevel5ProductSupport90ClaimRegistry.unsupportedDetectorCount,
};
