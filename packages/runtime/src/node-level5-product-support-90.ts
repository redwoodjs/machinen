import { nodeLevel5ProductSupport85ClaimRegistry } from "./node-level5-product-support-85.ts";

export const NODE_LEVEL5_PRODUCT_SUPPORT_90_KIND = "machinen.node-level5-product-support-90";
export const NODE_LEVEL5_PRODUCT_SUPPORT_90_VERSION = 1;

export type NodeLevel5ProductSupport90ClaimRegistry = {
  kind: typeof NODE_LEVEL5_PRODUCT_SUPPORT_90_KIND;
  status: "node-product-support-90-claimed";
  declaredSubsetExperimentalProductSupportClaimed: 100;
  nodeProductSupportTiers: readonly [20, 50, 65, 80, 85, 90];
  nodeProductSupportClaimed: 90;
  broadNodeProductSupportClaimed: 30;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  previousNodeProductSupportClaimed: 85;
  previousBroadNodeProductSupportClaimed: 25;
  frameworkCapabilityEvidenceRequired: true;
  frameworkIntrospectionCorpusRequired: true;
  frameworkProductEvidenceRequired: true;
  frameworkClaimReadyRequired: true;
  retainedEvidenceRequired: true;
  refusalArtifactEvidenceRequired: true;
  realVmCrossArchEvidenceRequired: true;
  artifactRetentionDays: 30;
  flakeBudgetPercent: 0;
  supportedAppRows: 68;
  refusedAppRows: 42;
  notProvenAppRows: 4;
  frameworkGraphArtifactCount: 18;
  restoredBehaviorProbeCount: 16;
  frameworkRefusalArtifactCount: 20;
  frameworkProductArtifactCount: 54;
  unsupportedDetectorCount: number;
};

export const nodeLevel5ProductSupport90ClaimRegistry: NodeLevel5ProductSupport90ClaimRegistry = {
  kind: NODE_LEVEL5_PRODUCT_SUPPORT_90_KIND,
  status: "node-product-support-90-claimed",
  declaredSubsetExperimentalProductSupportClaimed: 100,
  nodeProductSupportTiers: [20, 50, 65, 80, 85, 90],
  nodeProductSupportClaimed: 90,
  broadNodeProductSupportClaimed: 30,
  arbitraryProcessCrossArchRestoreClaimed: 0,
  previousNodeProductSupportClaimed: 85,
  previousBroadNodeProductSupportClaimed: 25,
  frameworkCapabilityEvidenceRequired: true,
  frameworkIntrospectionCorpusRequired: true,
  frameworkProductEvidenceRequired: true,
  frameworkClaimReadyRequired: true,
  retainedEvidenceRequired: true,
  refusalArtifactEvidenceRequired: true,
  realVmCrossArchEvidenceRequired: true,
  artifactRetentionDays: 30,
  flakeBudgetPercent: 0,
  supportedAppRows: 68,
  refusedAppRows: 42,
  notProvenAppRows: 4,
  frameworkGraphArtifactCount: 18,
  restoredBehaviorProbeCount: 16,
  frameworkRefusalArtifactCount: 20,
  frameworkProductArtifactCount: 54,
  unsupportedDetectorCount: nodeLevel5ProductSupport85ClaimRegistry.unsupportedDetectorCount,
};
